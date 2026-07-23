# redactor

## Purpose

The `redactor` extension prevents secret-like data from being written into files and reduces the chance that sensitive values leak into model-visible tool output.

## Public surface

Hooks:

- `tool_call`
- `tool_result`

This extension does not register commands or tools.

## How it works

### Write path

On `tool_call`:

- if the tool is `write`, the extension scans `content`
- if the tool is `edit`, it scans each edit `newText`
- it blocks the request when secret-like content is detected

### Read path

On `tool_result`:

- only `read`, `bash`, and `grep` are inspected
- text blocks are rewritten with redacted replacements
- non-text blocks are preserved unchanged

Detection combines known patterns and entropy-based heuristics, with false-positive filtering layered into the helper code.

## Key files

- `index.ts` — hook registration and block/redact flow
- `patterns.ts` — secret pattern catalog
- `secrets.ts` — entropy scoring, false-positive filtering, detection, and replacement

## Data and persistence

This extension has no dedicated persistence.

## Dependencies and integration

- runs before file-changing tools complete when secret-like content is present
- runs after `read`, `bash`, and `grep` so that later context sees redacted text
- complements `permission` by protecting content rather than access

## Edge cases and guardrails

- only `newText` is checked for edits, not `oldText`
- redaction touches only text content blocks
- detection attempts to reduce false positives before blocking writes
- secret-like tool output is redacted even if the source file or command already contains a real token

## Manual test checklist

- attempt a `write` containing a token-like string and verify that it is blocked
- attempt an `edit` adding a token-like string and verify that it is blocked
- run `read` on a file containing a fake key and verify redaction
- run `grep` or `bash` that prints a fake key and verify redaction
