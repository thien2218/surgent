# mini-router-match

Implement route matcher in `src/`.

Exports must stay:

- `matchBestRoute(routePatterns, requestPath)`

Rules:

- Normalize duplicated slashes and trailing slash.
- Segment types:
  - static segment must match exactly
  - `:param` captures one segment, decoded
  - `*` wildcard only valid as final segment and captures remaining decoded path in `params.splat`
- Return `null` when nothing matches.
- Return `{ pattern, params }` when matched.
- Scoring precedence: static > param > wildcard.
- Ties use first pattern order.
