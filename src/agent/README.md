# agent

## Purpose

The `agent` extension manages agent profiles and session-level agent selection. It materializes the active system prompt files and narrows the available tools, MCP servers, and model choice according to agent metadata.

## Public surface

Command:

- `/agents`

Hooks:

- `session_start`
- `before_agent_start`
- `agent_end`
- `session_shutdown`
- `tool_call`

Status UI:

- active agent name
- current mode label in the status line

This extension does not register any tools.

## How it works

1. `/agents` lists the available built-in and user-defined agent files.
2. The user can create, edit, or switch the active agent profile.
3. On session start, the extension resolves the active agent name from the session mapping or the built-in default.
4. The agent file frontmatter is parsed into `AgentMeta`; project-local `agent.meta.<name>` settings override built-in metadata.
5. The extension applies agent constraints:
   - it narrows the active tools with `pi.setActiveTools`
   - it selects a model and thinking level when metadata requests them
   - it lists enabled MCP servers in the prompt appendix
6. The agent body is written to `.pi/SYSTEM.md`.
7. The enabled MCP server section is written to `.pi/APPEND_SYSTEM.md`.
8. In subsessions, the `tool_call` hook applies stricter restrictions:
   - `subagent` is blocked
   - an explicit `path` is required for `read`, `write`, `edit`, `grep`, `find`, and `ls`

## Key files

- `index.ts` — extension entry, lifecycle hooks, and subsession tool restrictions
- `command.ts` — `/agents` picker, create flow, edit flow, and VS Code integration
- `helpers.ts` — agent configuration form helpers and frontmatter parsing support
- `storage.ts` — agent file discovery, parsing, serialization, session-agent persistence, and active-agent loading
- `types.ts` — `Agent`, `AgentMeta`, and allowlist types
- `built-in/default.md` — default main agent
- `built-in/planner.md` — built-in planner profile
- `built-in/reviewer.md` — built-in reviewer profile

## Data and persistence

- `.pi/agents.json` — session ID to active agent name mapping
- `.pi/settings.json` — `agent.mode` and built-in overrides under `agent.meta.<name>`
- `.pi/SYSTEM.md` — active agent body for the current session
- `.pi/APPEND_SYSTEM.md` — enabled MCP server appendix for the current session
- built-in agent markdown under `built-in/`, with description as its only metadata
- user and project agent files loaded through the storage layer, with metadata in frontmatter

## Dependencies and integration

- reads enabled MCP configuration through `mcp-client` storage
- child session restrictions are applied by `subsession` bridge extensions
- works with `permission` by reducing the active tool set before permission checks run
- built-in planner and reviewer profiles support the `commands` and `subsession` flows

## Edge cases and guardrails

- unreadable agent files are skipped
- a non-built-in agent named `default` is ignored
- an unknown model produces a warning instead of failing the session
- disabled or missing MCP servers are not appended to the prompt
- child tool policy is applied by the subsession bridge before tool execution

## Manual test checklist

- open `/agents` and switch to another built-in profile
- create a new custom agent and verify that it appears in the picker
- set a tool allowlist and verify that hidden tools disappear from the active set
- edit built-in metadata and verify `.pi/settings.json` changes while its markdown stays unchanged
- set a model and thinking level in agent metadata and verify both selections change
- run a subsession and confirm that its configured thinking level applies and pathless `grep`, `find`, or `ls` is blocked
