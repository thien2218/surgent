# Contributing to surgent

Thanks for helping improve `surgent`. This guide covers the local workflow for changes to the CLI coding agent and its pi extensions.

## Before you start

Read the [README](./README.md) for the project architecture, setup, and feature documentation.

## Setup

You need Node.js, Git, and either pnpm or npm.

```bash
git clone <repository-url>
cd surgent
node scripts/build.mjs
```

The build script installs dependencies (preferring pnpm when available), runs `npm link`, and creates the required `~/.pi/agent/` directories. You can then start the TUI with:

```bash
surgent
```

## Development workflow

1. Keep each change small and focused.
2. Follow the existing pi extension patterns under `src/`. Extensions export a default function that receives `ExtensionAPI`; multi-file extensions use an `index.ts` entry point.
3. Update the relevant extension documentation when behavior changes.

## Validate changes

There is no substantial automated test suite. Restart `surgent`, then manually exercise the affected TUI flow, especially for commands, tools, permission prompts, MCP setup, web authentication, or checkpoint behavior.

## Issues and pull requests

No issue or pull request templates are provided. To make a report actionable, include the behavior observed, the expected behavior, and steps to reproduce it.

Keep pull requests scoped to one reviewable change. Describe the behavior changed, any documentation updates, and the validation performed, including the manual flow you exercised and its result.

## Code of Conduct

Participation is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md).

## License

This project is available under the [MIT License](./LICENSE).
