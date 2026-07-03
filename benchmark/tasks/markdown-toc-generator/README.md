# markdown-toc-generator

Implement markdown TOC builder in `src/`.

Exports must stay:

- `buildTableOfContents(markdownText, options)`

Rules:

- Parse ATX headings only (`#` to `######` followed by at least one space).
- Ignore headings inside fenced code blocks delimited by triple backticks.
- `options.minLevel` default is `1`.
- `options.maxLevel` default is `6`.
- Return array of `{ level, text, slug }`.
- Slug rules:
  - lowercase
  - remove non alphanumeric characters except spaces and hyphens
  - collapse spaces to single hyphen
  - collapse repeated hyphens
  - trim hyphens at both ends
  - duplicate slugs get suffix `-2`, `-3`, ...
