# pi-context-optimizer

Context optimization extension for [Pi](https://github.com/earendil-works/pi). It gives coding agents more useful context by improving code navigation and reducing repeated or noisy tool output. It is also built into [surgent](https://github.com/thien2218/surgent).

## Why use it

Long coding sessions accumulate large tool results, repeated file content, and output that no longer helps with current task. That context costs tokens and can distract model from relevant code.

`pi-context-optimizer` keeps useful evidence while removing avoidable noise. It works automatically after installation and adds structural tools for reading only code needed for current task.

## What it does

- Adds `code_map`, which uses Tree-sitter to index symbols and declarations before files are read in full.
- Adds `inspect`, which returns one selected symbol body for targeted code reading and edits.
- Supports TypeScript, JavaScript, Python, Go, Java, and Rust code navigation.
- Compacts Bash output by stripping terminal control sequences and collapsing repeated or similar lines.
- Formats grep results by grouping matches under file paths and stores smaller summaries in session history.
- Removes older `read` and `inspect` results when newer results fully cover same content.
- Prunes empty tool results and superseded tool calls from model context and persisted sessions.

These changes reduce context growth, improve prompt-cache reuse, and leave more room for requirements, code, and reasoning.

## Requirements

- Node.js 22.19 or newer
- Pi coding agent

## Install

Install package through Pi:

```bash
pi install npm:pi-context-optimizer
```

Confirm installation:

```bash
pi list
```

Start or restart Pi in a repository. Extension loads automatically; agent can then use `code_map` and `inspect`, while output optimization runs in background.

> **Important:** surgent already includes this extension. Do not install standalone package alongside surgent in same configuration, because both copies would register same tools and hooks.

## License

[MIT](LICENSE)
