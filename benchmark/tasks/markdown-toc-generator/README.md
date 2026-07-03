# markdown-toc-generator

## Conventions

- Public API lives in `src/index.mjs`.
- Export name and signature are fixed:
  - `buildTableOfContents(markdownText, options)`

## Parsing rules

- Parse ATX headings only (`#` to `######` followed by at least one space).
- Ignore headings inside fenced code blocks delimited by triple backticks.
- Defaults:
  - `options.minLevel = 1`
  - `options.maxLevel = 6`
- Output shape: array of `{ level, text, slug }`.

## Slug rules

- Lowercase.
- Remove non-alphanumeric characters except spaces and hyphens.
- Collapse spaces into single hyphen.
- Collapse repeated hyphens.
- Trim hyphens from both ends.
- Duplicate base slug gets numeric suffix (`-2`, `-3`, ...).
