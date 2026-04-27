"""Web Fetch Tool — Jina-first with Camoufox fallback for blocked pages.

The agent always calls `web_fetch`. We try the fast path (Jina) first, then
fall back to Camoufox (a stealth Firefox build) only when the response looks
like a block: 403/429, Cloudflare challenge, captcha, or a near-empty body
on a real URL.

Same input contract and same return shape as the Jina provider — the agent
should not be able to tell which path served the response.
"""
import asyncio
import logging
import re

from langchain.tools import tool

from deerflow.community.jina_ai.jina_client import JinaClient
from deerflow.config import get_app_config
from deerflow.utils.readability import ReadabilityExtractor

logger = logging.getLogger(__name__)
readability_extractor = ReadabilityExtractor()

# Conservative block signatures. False positives are cheap (one extra
# Camoufox fetch); false negatives mean the agent gets a captcha page.
_BLOCK_HTTP_PATTERNS = (
    "Error: 403",
    "Error: 429",
    "Error: 503",
    "Error: timed out",
    "Error: timeout",
)
_BLOCK_BODY_PATTERNS = (
    "cf-browser-verification",
    "cf-challenge-running",
    "Just a moment...",
    "Checking your browser before",
    'id="captcha-bypass"',
    "g-recaptcha",
    "h-captcha",
    "px-captcha",
    "Access denied",
    "Attention Required! | Cloudflare",
)
_MAX_RESULT_CHARS = 4096


def _looks_blocked(content: str) -> bool:
    """Return True if the Jina response looks like a block, captcha, or challenge."""
    if not isinstance(content, str):
        return False
    if any(content.startswith(p) for p in _BLOCK_HTTP_PATTERNS):
        return True
    # HTML body sniffing — only run on the first ~4 KB to keep it fast.
    head = content[:4096]
    if any(p in head for p in _BLOCK_BODY_PATTERNS):
        return True
    return False


async def _fetch_via_camoufox(url: str, timeout_seconds: int) -> str | None:
    """Fetch a URL through Camoufox. Returns HTML on success, None on failure.

    Heavy import is deferred so the module loads even without camoufox installed
    (it's an optional dep — agent gets a clean error if it isn't there).
    """
    try:
        from camoufox.async_api import AsyncCamoufox  # type: ignore
    except ImportError:
        logger.warning("camoufox not installed — fallback unavailable; install with `uv add camoufox` and run `camoufox fetch`")
        return None

    try:
        async with AsyncCamoufox(headless=True) as browser:
            page = await browser.new_page()
            try:
                await page.goto(url, timeout=timeout_seconds * 1000, wait_until="domcontentloaded")
                # Brief settle for JS-rendered content / challenge solve.
                await page.wait_for_timeout(1500)
                html = await page.content()
            finally:
                await page.close()
        return html
    except Exception as e:
        logger.error(f"Camoufox fetch failed for {url}: {e}")
        return None


@tool("web_fetch", parse_docstring=True)
async def web_fetch_tool(url: str) -> str:
    """Fetch the contents of a web page at a given URL.

    Only fetch EXACT URLs that have been provided directly by the user or have been returned in results from the web_search and web_fetch tools.
    This tool can NOT access content that requires authentication, such as private Google Docs or pages behind login walls.
    Do NOT add www. to URLs that do NOT have them.
    URLs must include the schema: https://example.com is a valid URL while example.com is an invalid URL.

    Args:
        url: The URL to fetch the contents of.
    """
    jina_client = JinaClient()
    timeout = 10
    camoufox_timeout = 30

    config = get_app_config().get_tool_config("web_fetch")
    if config is not None:
        extra = config.model_extra or {}
        if "timeout" in extra:
            timeout = extra.get("timeout") or timeout
        if "camoufox_timeout" in extra:
            camoufox_timeout = extra.get("camoufox_timeout") or camoufox_timeout

    # Fast path: Jina.
    html_content = await jina_client.crawl(url, return_format="html", timeout=timeout)

    # Block detection → Camoufox fallback.
    if _looks_blocked(html_content):
        logger.info(f"web_fetch: Jina returned a block signal for {url}; falling back to Camoufox")
        camoufox_html = await _fetch_via_camoufox(url, timeout_seconds=camoufox_timeout)
        if camoufox_html:
            html_content = camoufox_html
        # If Camoufox itself failed/unavailable, fall through with the Jina
        # error so the agent sees a real error, not silent success.

    # If Jina cleanly errored *without* looking like a block (e.g. malformed URL,
    # unreachable host), pass the error through unchanged — Camoufox wouldn't help.
    if isinstance(html_content, str) and html_content.startswith("Error:"):
        return html_content

    article = await asyncio.to_thread(readability_extractor.extract_article, html_content)
    return article.to_markdown()[:_MAX_RESULT_CHARS]
