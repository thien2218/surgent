# mini-router-match

## Conventions

- Public API lives in `src/index.mjs`.
- Export name and signature are fixed:
  - `matchBestRoute(routePatterns, requestPath)`

## Matching rules

- Normalize duplicated slashes and trailing slash.
- Segment kinds:
  - static segment: exact match
  - `:param`: captures one decoded segment
  - `*`: wildcard only in final segment, captures remaining decoded path into `params.splat`
- No match returns `null`.
- Match returns `{ pattern, params }`.
- Scoring precedence: static > param > wildcard.
- Tie-breaker: first pattern order.
