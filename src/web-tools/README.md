# web-tools

## Purpose

The `web-tools` extension exposes external web search and page fetch capabilities with provider fallback, provider authentication, and a local fetch cache.

## Public surface

Command:

- `/web-login`

Tools:

- `web_search`
- `web_fetch`

## How it works

### `web_search`

1. The tool trims and validates the query.
2. It iterates through the configured search providers in priority order.
3. It loads the provider API key from auth storage.
4. It skips unconfigured providers and records the reason.
5. It returns the first non-empty result set.
6. If all providers fail, it returns a combined error summary.

### `web_fetch`

1. The tool validates the URL.
2. It normalizes the URL and computes the cache path.
3. It prunes expired daily cache directories.
4. It returns cached markdown when present.
5. Otherwise, it tries the fetch providers in order.
6. On success, it persists the fetched markdown to the cache and returns a formatted result with the file path and outline.

### `/web-login`

This interactive command supports:

- choosing a provider
- saving an API key
- clearing an API key
- viewing masked provider status

## Key files

- `index.ts` — registration
- `settings.ts` — provider order and labels
- `providers/index.ts` — provider factory
- `providers/native.ts` — direct HTTP fetch provider
- `providers/jina.ts` — Jina fetch provider
- `providers/brave.ts` — Brave search provider
- `providers/firecrawl.ts` — Firecrawl provider
- `providers/tavily.ts` — Tavily provider
- `web-search/index.ts` — `web_search` tool
- `web-search/helpers.ts` — result normalization and error formatting
- `web-fetch/index.ts` — `web_fetch` tool
- `web-fetch/helpers.ts` — URL validation and response formatting
- `web-fetch/parser.ts` — fetched-content parsing
- `web-fetch/storage.ts` — cache paths and read/write helpers
- `web-login/index.ts` — `/web-login` flow
- `web-login/helpers.ts` — provider lookup and API-key masking helpers

## Data and persistence

- fetch cache under `.pi/web-results/` with daily buckets
- cache file names use the MD5 of the canonical URL plus `.md`
- provider API keys live in auth storage, not in an extension-owned JSON file

Provider order from current settings:

### Search providers

- Tavily
- Brave Search
- Firecrawl

### Fetch providers

- native
- Jina
- Firecrawl
- Tavily

## Dependencies and integration

- `web_fetch` is guarded by `permission`
- the active agent profile can allow or deny web tools through the tool allowlist
- cached fetch results pair well with `grep` and narrow reads later

## Edge cases and guardrails

- an empty query is rejected
- an unconfigured provider is skipped rather than treated as a fatal error by itself
- `web_search` returns the first provider with non-empty results
- `web_fetch` uses a daily cache and prunes old cache directories
- invalid URLs fail before any provider call

## Manual test checklist

- configure Tavily, Brave, or Firecrawl through `/web-login`
- run `web_search` and verify that ranked results are returned
- run `web_fetch` twice on the same public URL and verify that the second run hits the cache
- clear a provider key and verify that the provider status updates
- try an invalid URL and verify that a validation error is returned
