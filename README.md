# surgent

## What is surgent?

`surgent` is a CLI coding agent built on top of `@earendil-works/pi-coding-agent`.
It preserves the upstream pi runtime and adds project-focused tools, commands, permission flows, subsessions, MCP integration, web tooling, token optimizers, and TUI customizations.

The primary entrypoint is the `surgent` command, which launches an interactive terminal UI.

## Why exist?

The pi framework provides a capable agent runtime. `surgent` adds an opinionated workflow layer for day-to-day repository work.

In particular, it is designed to support:

- reusable planning and review loops
- stricter access control for file, shell, and web operations
- lower-token code inspection workflows
- integrated MCP server management
- built-in web search and web fetch capabilities
- git-backed code checkpoints across session tree navigation

The overall goal is to make repository work faster, safer, and more consistent.

## Key features

- custom commands: `/agents`, `/mcp`, `/permissions`, `/plan`, `/review`, `/web-login`
- custom tools: `code_diff`, `code_map`, `inspect`, `list_mcp_tools`, `call_mcp_tool`, `questionnaire`, `web_search`, `web_fetch`
- agent profiles with per-agent tool, model, and MCP allowlists
- reusable planner and reviewer subsessions
- permission rules for file, shell, and web access
- a YOLO mode toggle for bypassing permission prompts when appropriate
- secret write blocking and secret redaction in tool output
- checkpoint restore prompts during session tree navigation
- tree-sitter-backed code mapping and symbol inspection
- provider-backed web search and cached web page fetch

## Architecture overview

The project is organized around pi extensions plus a small number of support modules.

At a high level:

1. `agent` loads the active agent profile and writes the session prompt files.
2. `permission` governs sensitive tool calls.
3. `optimizers` provides code-aware tools and token-saving context compaction.
4. feature extensions such as `mcp-client`, `web-tools`, `code-diff`, and `questionnaire` add domain-specific capabilities.
5. `commands` relies on the `subsession` support module to run planner and reviewer child sessions.
6. `checkpoint`, `cleanup`, and `redact-secrets` protect code state and session output.
7. `ui` customizes the TUI header and editor mode indicator.

Not every directory under `src/` is a standalone extension. `subsession/` is a shared support module, and `utils.ts` is a shared helper module.

## Extension map

Primary documented extension directories:

- [`src/agent/README.md`](./src/agent/README.md) — agent profiles, active prompt materialization, and subsession tool restrictions
- [`src/checkpoint/README.md`](./src/checkpoint/README.md) — git-backed restore points for session tree navigation
- [`src/cleanup/README.md`](./src/cleanup/README.md) — cleanup for stale `.pi` state on session start
- [`src/code-diff/README.md`](./src/code-diff/README.md) — structured git and GitHub diff inspection
- [`src/commands/README.md`](./src/commands/README.md) — `/plan` and `/review` workflows
- [`src/mcp-client/README.md`](./src/mcp-client/README.md) — MCP configuration, discovery, and tool invocation
- [`src/optimizers/README.md`](./src/optimizers/README.md) — `code_map`, `inspect`, grammar bootstrap, and context pruning
- [`src/permission/README.md`](./src/permission/README.md) — file, shell, and web access control plus permission management UI
- [`src/questionnaire/README.md`](./src/questionnaire/README.md) — structured clarifying-question workflow
- [`src/redact-secrets/README.md`](./src/redact-secrets/README.md) — secret detection and redaction
- [`src/web-tools/README.md`](./src/web-tools/README.md) — web search, web fetch, authentication, and cache handling

Supporting modules documented separately:

- [`src/subsession/README.md`](./src/subsession/README.md) — child-session runtime used by `/plan` and `/review`
- `src/utils.ts` — shared `.pi` path resolution, JSON IO, and command helpers

## How session flow works

A typical interactive session proceeds as follows:

1. `surgent` starts.
2. The CLI synchronizes `.piignore` from `.gitignore` when needed and ensures `.pi` is excluded from git status noise.
3. Global pi settings are updated so the extension directories in this checkout are available to the runtime.
4. The session begins.
   - `cleanup` prunes stale state.
   - `agent` loads the active agent and writes `.pi/SYSTEM.md`.
   - `checkpoint` loads checkpoint state.
   - `optimizers` ensures the grammar cache is available.
   - `ui` installs the custom header and editor component.
5. The agent turn runs.
   - `permission` intercepts guarded tools.
   - `redact-secrets` blocks unsafe writes and redacts sensitive output.
   - custom tools execute as needed.
   - `optimizers` compacts bulky results for future context.
6. The user may branch the session tree, resume an older node, or run a planner or reviewer subsession.
7. On tree jumps or forks, `checkpoint` may offer to restore the worktree.
8. On shutdown, active MCP connections are disposed.

## Project structure

```text
.
├── bin/
│   └── surgent.js
├── scripts/
│   └── build.mjs
├── src/
│   ├── agent/
│   ├── checkpoint/
│   ├── cleanup/
│   ├── code-diff/
│   ├── commands/
│   ├── mcp-client/
│   ├── optimizers/
│   ├── permission/
│   ├── questionnaire/
│   ├── redact-secrets/
│   ├── subsession/
│   ├── test/
│   ├── ui/
│   ├── utils.ts
│   └── web-tools/
├── AGENTS.md
├── package.json
└── tsconfig.json
```

## Installation

Prerequisites:

- Node.js
- `pnpm` or `npm`
- `git`

Clone the repository, then run:

```bash
node scripts/build.mjs
```

This script:

- installs dependencies with `pnpm` or `npm`
- runs `npm link`
- creates the required `~/.pi/agent/` directories

After the script completes, the `surgent` command should be available globally.

## Quick start

Start `surgent` in the repository you want to work on:

```bash
surgent
```

Common first steps inside the application:

1. run `/agents` to inspect the active agent profile
2. run `/permissions` to review access rules
3. run `/web-login` if web tools require provider keys
4. run `/mcp` if the repository depends on MCP servers
5. use `/plan` or `/review` for delegated analysis loops

## Configuration

Important locations:

- project state: `.pi/`
- global state: `~/.pi/agent/`
- path block rules: `.piignore`
- initial ignore source: `.gitignore`

Common files created or updated by `surgent`:

- `.pi/SYSTEM.md`
- `.pi/APPEND_SYSTEM.md`
- `.pi/agents.json`
- `.pi/checkpoints.json`
- `.pi/mcp.json`
- `.pi/permissions.json`
- `.pi/settings.json`
- `.pi/subsessions.json`
- `.pi/subsessions/`
- `.pi/web-results/`
- `~/.pi/agent/settings.json`

Agent files are loaded from:

- project `.pi/agents/`
- global `~/.pi/agent/agents/`
- built-in agent files under `src/agent/built-in/`

## Built-in commands

`surgent` adds the following primary commands:

- `/agents` — list, create, edit, and switch agent profiles
- `/mcp` — add, edit, enable, disable, or delete MCP server configuration
- `/permissions` — inspect and edit permission rules
- `/plan` — run the planner in a reusable planning subsession
- `/review` — run the reviewer in a reusable review subsession
- `/web-login` — save or clear API keys for supported web providers

Additional commands may also be available through the upstream pi framework.

## Built-in tools

`surgent` adds the following primary tools:

- `code_diff` — compare uncommitted changes, commit ranges, or GitHub pull requests
- `code_map` — generate a fast symbol map with line ranges
- `inspect` — fetch an exact symbol body with optional depth collapsing
- `list_mcp_tools` — discover tools from configured MCP servers
- `call_mcp_tool` — invoke a known tool on a configured MCP server
- `questionnaire` — ask focused, structured clarifying questions in the UI
- `web_search` — search the web or current news through configured providers
- `web_fetch` — fetch and cache content from a known public URL

Upstream pi tools remain available as well, subject to the active agent profile.

## Agents and subsessions

Agents are markdown files with frontmatter metadata and a prompt body. The metadata can narrow:

- allowed tools
- allowed MCP servers
- model choice
- related policy fields

Built-in agent profiles currently include:

- `default`
- `planner`
- `reviewer`

Subsessions are child `surgent` runs stored under a dedicated session directory. They power the reusable `/plan` and `/review` workflows, can be resumed by identifier, and can hand pending permission or questionnaire interactions back to the parent UI.

## Permissions and safety model

The safety model is layered:

1. the active agent profile narrows the available tool set
2. `.piignore` blocks ignored paths
3. permission rules allow, block, or prompt for guarded tools
4. suspicious shell patterns trigger a danger-prompt path
5. secret-like content is blocked on writes and redacted from `read`, `bash`, and `grep` output
6. checkpoint restore prompts protect code state during tree navigation
7. cleanup removes stale session-linked state

Currently guarded tools are:

- `read`
- `write`
- `edit`
- `bash`
- `web_fetch`

YOLO mode bypasses permission prompts and should therefore be used carefully.

## MCP support

`surgent` can manage MCP servers directly from the TUI. Supported transport types are:

- `stdio`
- `http`

Typical workflow:

1. add a server with `/mcp`
2. inspect the available remote tools with `list_mcp_tools`
3. call a remote capability with `call_mcp_tool`

Enabled MCP servers can also be surfaced in the active prompt context for the current agent.

## Web tools

Two web capabilities are built in:

- `web_search` for discovery
- `web_fetch` for fetching known URLs and caching markdown locally

Supported providers:

- search: Tavily, Brave Search, Firecrawl
- fetch: native, Jina, Firecrawl, Tavily

Use `/web-login` to store provider API keys.

## Development

Useful commands:

```bash
node scripts/build.mjs
pnpm tsc --noEmit
```

Reference documentation for the pi framework is available in:

- `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- `node_modules/@earendil-works/pi-coding-agent/docs/tui.md`
- `node_modules/@earendil-works/pi-coding-agent/docs/sdk.md`
- `node_modules/@earendil-works/pi-coding-agent/docs/models.md`
- `node_modules/@earendil-works/pi-coding-agent/docs/skills.md`

Project-specific guidance is documented in [`AGENTS.md`](./AGENTS.md).

## How to add or modify extension

1. create or update a TypeScript module under `src/`
2. export a default extension entry from `index.ts`
3. register commands, tools, hooks, or UI integrations through `ExtensionAPI`
4. run the type check
5. manually verify the flow in the TUI

Patterns used in this repository:

- multi-file extensions live in a directory under `src/`
- support modules may live beside extensions without being registered themselves
- global extension registration is refreshed by `bin/surgent.js`

## Testing and validation

Current automated validation is limited. The primary repository-level check is:

```bash
pnpm tsc --noEmit
```

Manual validation remains important for:

- TUI workflows
- permission prompts
- subsession handoff behavior
- MCP server setup
- web provider authentication and fetch cache behavior
- checkpoint restore prompts

## Known limits

- there is no substantial automated test suite yet
- several important workflows require an interactive TUI to verify
- `code_map` and `inspect` grammar support currently covers TypeScript, Python, Go, and Java
- `code_diff` pull request mode depends on `gh`
- checkpoint features assume a git repository with a usable worktree
- web tools require provider keys for most non-native behavior

## Contributing

- read [`AGENTS.md`](./AGENTS.md) first
- keep changes small and focused
- follow existing pi extension patterns
- update extension documentation when behavior changes
- run `pnpm tsc --noEmit` before handing work off

## License

ISC
