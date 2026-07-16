# redactor

## Purpose

The `redactor` extension blocks generated opaque text from file writes and replaces it in model-visible tool output with `<redacted_arbitrary_text>`.

## Public surface

Hooks:

- `tool_call`
- `tool_result`

This extension does not register commands or tools.

## How it works

### Write path

On `tool_call`:

- `write` content is scanned for generated opaque text
- each `edit` `newText` is scanned for generated opaque text
- matching content blocks request

### Read path

On `tool_result`:

- only `read`, `bash`, and `grep` are inspected
- matching text becomes `<redacted_arbitrary_text>`
- non-text blocks are preserved

## Detected formats

- Base64 text with numeric or Base64 punctuation
- hex hashes
- JWTs
- bcrypt and Argon2 hashes
- PEM blocks

## Key files

- `index.ts` — hook registration and block/redact flow
- `redact.ts` — generated-text detection and redaction

## Data and persistence

This extension has no dedicated persistence.

## Dependencies and integration

- runs before file-changing tools complete when generated opaque text is present
- runs after `read`, `bash`, and `grep` so later context sees redacted output
- complements `permission` by protecting content rather than access

## Manual test checklist

- attempt a `write` containing Base64, a hash, JWT, password hash, or PEM block and verify it is blocked
- run `read`, `grep`, or `bash` that prints one of those formats and verify `<redacted_arbitrary_text>`
- run `node src/redactor/redact.test.mjs`
