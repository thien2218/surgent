# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Surgent

Surgent is a CLI coding agent that extends the `@earendil-works/pi-coding-agent` framework with custom tools, commands, and UI. It runs as a TUI via the `surgent` command.

## Reference documentation

Before implementing or modifying any feature, read the relevant pi docs:

- **Extensions** (tools, commands, events, lifecycle): `node_modules/.ignored/@earendil-works/pi-coding-agent/docs/extensions.md`
- **TUI/Custom UI**: `node_modules/.ignored/@earendil-works/pi-coding-agent/docs/tui.md`
- **SDK usage**: `node_modules/.ignored/@earendil-works/pi-coding-agent/docs/sdk.md`
- **Models/providers**: `node_modules/.ignored/@earendil-works/pi-coding-agent/docs/models.md`
- **Skills and prompts**: `node_modules/.ignored/@earendil-works/pi-coding-agent/docs/skills.md`
- **Examples**: `node_modules/.ignored/@earendil-works/pi-coding-agent/examples/extensions/`

## How to implement features

All features are **pi extensions** — TypeScript modules that export a default function receiving the `ExtensionAPI` instance. Extensions are registered in `.pi/settings.json`.

The three kinds of extensions used in this project:

- **Tools** — callable by the AI during a session (register with `pi.registerTool()`)
- **Commands** — slash commands for the user in the TUI (register with `pi.registerCommand()`)
- **UI components** — visual customizations rendered in the TUI (register with `pi.registerMessageRenderer()` or `ctx.ui.custom()`)

Multi-file extensions live as a directory under `src/` with an `index.ts` entry point. Single-concern additions can be a single `.ts` file.

## After implementation

Run type checking to validate the change:

```bash
pnpm tsc --noEmit
```

Then tell the user what to manually test, why and how. This should only run as-is exactly once every time you finalize an edit/write.

## Rules

- Single char variable names are strictly forbidden
