# code-diff

## Purpose

The `code-diff` extension exposes structured diff inspection for working tree changes, commit-to-commit comparisons, and GitHub pull requests.

## Public surface

Tool:

- `code_diff`

This extension does not register commands.

Supported modes:

- `pr`
- `hash`
- `uncommitted`

## How it works

1. The tool validates the mode-specific parameters.
2. Execution is dispatched by mode:
   - `pr` uses GitHub pull request diff retrieval through `gh`
   - `hash` compares a base reference with a target hash through `git`
   - `uncommitted` compares the current working tree through `git`
3. When `files` is omitted, the tool returns a summary of changed files.
4. When `files` is present, the tool filters the patch output to the selected files.
5. The result renderer shows a concise TUI summary while the full diff remains available in the tool content.

## Key files

- `index.ts` — tool schema, execution wrapper, renderers, and default extension export
- `flow.ts` — main mode dispatcher and per-mode execution flow
- `command.ts` — git and `gh` command helpers, commit resolution, and pull request fetch helpers
- `parser.ts` — numstat parsing, changed-file extraction, and patch filtering
- `result.ts` — summary and patch result builders
- `types.ts` — input and result typing

## Data and persistence

This extension has no dedicated persistence.

It reads from:

- git history
- the git working tree
- GitHub CLI output for pull request mode

## Dependencies and integration

- depends on `git`
- pull request mode depends on `gh`
- is useful within `review` workflows and manual code-inspection flows
- still passes through the shared context and safety layers like any other tool result

## Edge cases and guardrails

- tool guidance encourages summary-first usage to keep context small
- a non-zero command exit becomes an explicit tool error
- unknown commit references are resolved before the diff attempt where required
- file filtering prevents the entire patch from being returned when only a narrow slice is needed

## Manual test checklist

- run an uncommitted diff without `files` and verify the summary result
- rerun with a single file in `files` and verify that the patch narrows correctly
- run hash mode between two commits
- run pull request mode with a configured `gh` installation
- verify that a clean tree reports no changed files
