"""Web Search Tool — SearXNG (local metasearch, no API key required).

Talks to a local SearXNG instance on http://localhost:8888 by default.
Override via the `base_url` field in config.yaml's web_search tool block.
"""
import json
import logging
import urllib.parse
import urllib.request
import urllib.error

from langchain.tools import tool

from deerflow.config import get_app_config

logger = logging.getLogger(__name__)

DEFAULT_BASE_URL = "http://localhost:8888"
DEFAULT_TIMEOUT_SECONDS = 15


def _searxng_search(
    query: str,
    base_url: str,
    max_results: int,
    timeout_seconds: int,
) -> list[dict]:
    """Query SearXNG's JSON API. Returns [] on any failure (caller decides UX)."""
    params = {
        "q": query,
        "format": "json",
        "language": "en",
        "safesearch": "0",
        "categories": "general",
    }
    url = f"{base_url.rstrip('/')}/search?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            # SearXNG rejects requests with no UA in some configs.
            "User-Agent": "DeerFlow/1.0 (+https://github.com/bytedance/deer-flow)",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_seconds) as r:
            payload = json.loads(r.read())
    except (urllib.error.URLError, urllib.error.HTTPError, OSError) as e:
        logger.error(f"SearXNG request failed ({base_url}): {e}")
        return []
    except json.JSONDecodeError as e:
        logger.error(f"SearXNG returned non-JSON: {e}")
        return []

    results = payload.get("results") or []
    return results[:max_results]


@tool("web_search", parse_docstring=True)
def web_search_tool(
    query: str,
    max_results: int = 5,
) -> str:
    """Search the web for information. Use this tool to find current information, news, articles, and facts from the internet.

    Args:
        query: Search keywords describing what you want to find. Be specific for better results.
        max_results: Maximum number of results to return. Default is 5.
    """
    config = get_app_config().get_tool_config("web_search")

    base_url = DEFAULT_BASE_URL
    timeout_seconds = DEFAULT_TIMEOUT_SECONDS

    if config is not None:
        extra = config.model_extra or {}
        if "max_results" in extra:
            max_results = extra.get("max_results", max_results)
        if "base_url" in extra:
            base_url = extra.get("base_url", base_url) or base_url
        if "timeout_seconds" in extra:
            timeout_seconds = extra.get("timeout_seconds", timeout_seconds) or timeout_seconds

    results = _searxng_search(
        query=query,
        base_url=base_url,
        max_results=max_results,
        timeout_seconds=timeout_seconds,
    )

    if not results:
        return json.dumps(
            {
                "error": "No results found (or SearXNG unreachable). "
                         "Verify the SearXNG container is running: `docker ps | grep searxng`.",
                "query": query,
            },
            ensure_ascii=False,
        )

    normalized = [
        {
            "title": r.get("title", ""),
            "url": r.get("url", ""),
            "content": r.get("content", "") or r.get("snippet", ""),
        }
        for r in results
    ]

    return json.dumps(
        {
            "query": query,
            "total_results": len(normalized),
            "results": normalized,
        },
        indent=2,
        ensure_ascii=False,
    )
