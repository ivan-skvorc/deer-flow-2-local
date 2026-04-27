# deer-flow-2-local

A personal fork of [bytedance/deer-flow](https://github.com/bytedance/deer-flow)
focused on **cost-saving local model integration** and **better internet access**
for fully offline-capable research workflows.

> ⚠️ **Vibe-coded with Claude.** Read diffs before trusting, test locally before
> anything that matters, and don't deploy to production without a human in the loop.

## What this fork adds

1. **Ollama auto-sync.** `make dev` queries your local Ollama daemon and
   reconciles `config.yaml`'s `models:` section. Tool-capable models surface
   first; non-tool models are still shown but dimmed `(no tools)` in the UI.
2. **Subagent model dropdown** in Ultra mode. Pick the subagent model
   per-conversation, independent of the Lead. Defaults to "Follow lead".
   The override travels in `RunnableConfig.configurable` only — never in
   graph state — to avoid the message-history bug the previous fork hit.
3. **SearXNG as default web search.** A local SearXNG container starts
   automatically with `make dev`. Replaces upstream's DuckDuckGo default;
   no external API keys needed for normal searches.
4. **Camoufox fallback for `web_fetch`.** Stealth Firefox transparently
   takes over when Jina returns a block / captcha / Cloudflare challenge.
   The agent calls `web_fetch` like before; the fallback is invisible.
5. **`make doctor`** extended with Ollama / SearXNG / Camoufox health checks.

## Forked from

Upstream commit: `9dc25987e05e71ae87db0da22a63b4290c5e9747` (April 2026).

## Quick start

Same as upstream, with two extras handled automatically:

```bash
git clone https://github.com/ivan-skvorc/deer-flow-2-local.git
cd deer-flow-2-local
make check       # verify prerequisites
make install     # backend + frontend deps + camoufox browser (~150 MB, one-time)
make config      # generate config.yaml + .env from templates
# edit .env to add an API key (Anthropic recommended)
make dev         # auto-starts SearXNG, syncs Ollama, runs the app
```

Open <http://localhost:3000> for the hot-reloading dev UI (Subagent dropdown
visible in Ultra mode). The production build is at <http://localhost:2026>.

## Prerequisites (Manjaro / Arch)

```bash
sudo pacman -Syu --needed nodejs-lts-jod npm nginx git github-cli python uv docker docker-compose
sudo corepack enable
sudo systemctl enable --now docker
sudo usermod -aG docker $USER   # log out / log in after this
```

Then optional but recommended for the local-models case:

* [Ollama](https://ollama.com/download) — `curl -fsSL https://ollama.com/install.sh | sh`

For other operating systems, see [`README.upstream.md`](./README.upstream.md).

## Using the Subagent dropdown

Visible only in **Ultra mode** (the mode where subagents are enabled).

* **"Follow lead"** (default) — subagent uses whatever Lead is using.
* Pick any other model — that model takes over all subagent tasks for the
  current thread. Tool-capable models appear first; non-tool models are
  dimmed and tagged `(no tools)`. Pick a non-tool model only if you know
  what you're doing — they can't drive subagents.

Cost-saving recipes:

| Lead | Subagent | Rationale |
| --- | --- | --- |
| Claude Sonnet 4.6 | Claude Haiku 4.5 | Reliable tool calls, cheap subagent |
| Claude Sonnet 4.6 | qwen3:32b (local) | Cloud lead, offline subagent churn |
| GPT-5 | Gemini 2.5 Flash | Cheap cloud subagent churn |

## Ollama notes

* Pull models with `ollama pull <name>`; remove with `ollama rm <name>`.
  Either way, `make dev` re-syncs `config.yaml` on next startup.
* The auto-sync writes a sentinel-bounded block inside `models:`. Anything
  outside that block is left alone — your hand-tuned cloud models are safe.
* Many Ollama models declare `tools` capability via `ollama show` but emit
  fake markdown tool calls instead of real ones. Verified-good picks:
  `qwen3:32b`, `gemma3:27b`. If a model misbehaves, just don't pick it.
* Override the Ollama host: `OLLAMA_HOST=192.168.1.50:11434 make dev`.

## SearXNG notes

* Auto-starts on `make dev` via `docker/searxng/docker-compose.yml`.
* Bound to `127.0.0.1:8888` only — never exposed beyond loopback.
* Stop with `make searxng-down`; logs via `docker logs deerflow-searxng`.
* To switch back to DuckDuckGo or Tavily, edit `config.yaml`'s `web_search`
  entry — the SearXNG block has alternates commented in for easy swap.

## Camoufox notes

* `make install` runs `camoufox fetch` once (~150 MB). If it failed (offline
  during install), re-run with `make camoufox-fetch`.
* Triggered automatically when Jina returns a block signal (403/429/captcha/
  Cloudflare). If you're seeing it run for sites that *should* work via
  Jina, check the false-positive list in
  `backend/packages/harness/deerflow/community/camoufox/tools.py`.

## Syncing with upstream

Upstream moves; this fork pins to a snapshot. To pull their latest:

```bash
git fetch upstream
git merge upstream/main       # may conflict — resolve and re-test
git push origin main
```

If conflicts get ugly, reset to `upstream/main` and re-apply this fork's
single commit on top.

## License

MIT, inherited from upstream. Fork adds no additional terms.

## Upstream docs

This README documents only the fork's additions. For everything else —
architecture, full feature list, API reference, contributing — see
[`README.upstream.md`](./README.upstream.md).
