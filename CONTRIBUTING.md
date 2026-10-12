# Contributing to surgent

Thanks for helping improve `surgent`. This guide covers the local workflow for changes to the CLI coding agent and its pi extensions.

## Before you start

Read the [README](./README.md) for the project architecture, setup, and feature documentation.

## Setup

You need Node.js 22.19 or newer, Git, and either pnpm or npm.

```bash
git clone <repository-url>
cd surgent
node bin/build.mjs
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

Run the test suite and type check before opening a pull request:

```bash
pnpm test
pnpm tsc --noEmit
```

Add or update tests for behavior you change. The [testing guide](./test/README.md) explains how to choose between unit, contract, integration, and end-to-end tests.

Tests do not cover the live TUI. Restart `surgent`, then manually exercise the affected flow, especially for commands, tools, permission prompts, MCP setup, web authentication, or checkpoint behavior.

## Commits

Split commits by independently reviewable behavior, and leave the repository valid after every commit. Use `<type>: <desc>` or `<type>(<scope>): <desc>` for messages, for example `fix(code-map): preserve partial results`.

## Issues and pull requests

Use the bug report or feature request form when opening an issue. Bug reports need steps to reproduce, the expected behavior, and your provider and model, since agent behavior often depends on them.

Keep pull requests scoped to one reviewable change. The pull request template asks for the motivation, validation, breaking changes, and documentation updates, including the manual flow you exercised and its result.

## Security

Do not report vulnerabilities in public issues. Follow the [security policy](./SECURITY.md) to report them privately.

## Code of Conduct

Participation is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md).

## License

This project is available under the [MIT License](./LICENSE).
