# mcp-client

## Purpose

The `mcp-client` extension manages MCP server configuration and exposes remote MCP tools through local pi tools.

## Public surface

Command:

- `/mcp`

Tools:

- `list_mcp_tools`
- `call_mcp_tool`

Hook:

- `session_shutdown` disposes active MCP connections

## How it works

1. `/mcp` opens the interactive management flow.
2. The user can add, edit, delete, or toggle server configuration.
3. The configuration loader merges and normalizes project and global server definitions.
4. `McpClientManager` caches live connections by server name and configuration hash.
5. `list_mcp_tools` connects to the requested servers and returns tool metadata, optionally filtered by a regular expression.
6. `call_mcp_tool` validates the server and remote tool name, then forwards JSON arguments to the remote tool.
7. On session shutdown, all live transports are closed.

## Key files

- `index.ts` — registration and lifecycle management
- `client.ts` — connection cache, transport creation, and disposal
- `command.ts` — `/mcp` interactive management flow
- `call-tool.ts` — `call_mcp_tool` wrapper and result formatting
- `list-tools.ts` — `list_mcp_tools` wrapper
- `storage.ts` — configuration loading, merging, resolution, and normalization
- `helpers.ts` — edit helpers and configuration template building
- `validation.ts` — TypeBox-based edit validation
- `types.ts` — stdio and HTTP MCP configuration types

## Data and persistence

- `.pi/mcp.json` in project scope
- global `~/.pi/agent/mcp.json` in home scope

Supported transports:

- `stdio` — command, arguments, current working directory, and environment
- `http` — URL and optional headers

## Dependencies and integration

- `agent` reads enabled MCP servers and appends them to prompt context
- active agent metadata can narrow which MCP servers are relevant to the model
- remote tool calls still flow through the main session logging and context pipeline

## Edge cases and guardrails

- disabled servers are rejected before any connection attempt
- unknown server names direct the user back to `/mcp`
- unknown remote tool names return the available tool list when present
- configuration edits replace the cached connection when the configuration hash changes
- HTTP transports terminate the remote session before closing during disposal

## Manual test checklist

- add a stdio MCP server through `/mcp`
- list tools from that server
- call a known remote tool with valid JSON arguments
- disable the server and verify that tool calls fail
- edit the server configuration and confirm that a new connection is used
- add an HTTP server and verify that cleanup closes the session on shutdown
