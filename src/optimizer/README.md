# pi-optimizer

Context optimization extension for [Pi](https://github.com/earendil-works/pi). It gives coding agents more useful context by improving code navigation and reducing repeated or noisy tool output. It is also built into [surgent](https://github.com/thien2218/surgent).

## Why use it

Long coding sessions accumulate large tool results, repeated file content, and output that no longer helps with current task. That context costs tokens and can distract model from relevant code.

`pi-optimizer` keeps useful evidence while removing avoidable noise. It works automatically after installation and adds structural tools for reading only code needed for current task.

## What it does

- Adds `code_map`, which uses Tree-sitter to index symbols and declarations before files are read in full.
- Adds `inspect`, which returns one selected symbol body for targeted code reading and edits.
- Supports TypeScript, JavaScript, Python, Go, Java, and Rust code navigation.
- Losslessly compresses consecutive Bash lines with at most one varying alphanumeric token: `status {204, 404, 500}`. Order, duplicates, and raw bytes remain recoverable; `{{` / `}}` escape literal braces. Compression applies only when shorter. Bash output limits still apply.
- Reduces grep output during execution by grouping matches under file paths.
- Filters older eligible `inspect` exchanges and pre-write `read`/`inspect` exchanges from model requests using a session-start snapshot.
- Persistently prunes eligible error and empty tool results, together with their tool calls, through append-only context edits.

These changes reduce context growth, improve prompt-cache reuse, and leave more room for requirements, code, and reasoning.

## Context filtering

At `session_start`, optimizer snapshots the current branch. For model requests only, it hides older eligible `inspect` exchanges for the same normalized file path and exact returned symbol, and older same-file `read`/`inspect` exchanges superseded by a successful `write`. Both tool calls and results are hidden. There is no general `read` deduplication, and edits or shell commands do not invalidate earlier results.

Changes after startup are deferred until the next session start. Session tree navigation clears the snapshot. This transient filtering leaves raw history, the TUI, exports, and Pi's canonical context for native compaction unchanged.

Separately, when the agent settles after successful completion, eligible error results (except Bash errors) and recognized empty `ls`/`find` results are pruned with their tool calls through persistent, append-only context edits. These change future model context without rewriting raw history.

## Requirements

- Node.js 22.19 or newer
- Pi coding agent

## Install

Install package through Pi:

```bash
pi install npm:pi-optimizer
```

Confirm installation:

```bash
pi list
```

Start or restart Pi in a repository. Extension loads automatically; agent can then use `code_map` and `inspect`, while output optimization runs in background.

> **Important:** surgent already includes this extension. Do not install standalone package alongside surgent in same configuration, because both copies would register same tools and hooks.

## License

[MIT](LICENSE)
