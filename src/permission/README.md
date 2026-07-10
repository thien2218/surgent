# permission

## Purpose

The `permission` extension is the central access-control layer for file, shell, and web operations. It also owns the user-visible permission management workflow and the YOLO mode toggle.

## Public surface

Command:

- `/permissions`

Shortcut:

- toggle YOLO mode through the registered switch key

Hooks:

- `session_start`
- `before_agent_start`
- `agent_end`
- `session_shutdown`
- `tool_call`

Exported helper:

- `askForPermission`

Guarded tools:

- `read`
- `write`
- `edit`
- `bash`
- `web_fetch`

## How it works

1. On session start, the extension loads the active agent metadata and the persisted mode.
2. The status line is updated to show the current mode.
3. Before each agent turn, the extension checks for a recent mode override in session history.
4. On each guarded `tool_call`, it:
   - collects `.piignore` inputs from the tool payload
   - blocks immediately if an ignored path matches
   - builds a `PermissionCheck` from the tool name and input
   - skips further checks in YOLO mode
   - applies the active agent runtime rules as a hard ceiling
   - resolves stored permission by scope precedence
   - allows, blocks, or prompts the user
5. If a prompt is needed, the interactive UI can allow once, block, or persist a rule depending on the chosen flow.
6. `/permissions` allows the user to inspect and edit stored rules directly.

### Rule precedence

Resolution order:

1. global `always`
2. project
3. parent session for subsession requests
4. current session

For file rules, `write` implies `read`. Outside matching explicit rules, file access inside the project root or the global `.pi` root defaults to allowed. Other file paths fall back to a prompt.

### Bash-specific behavior

- suspicious shell patterns mark the request as dangerous and still prompt
- path-like shell arguments are recursively checked as file reads

## Key files

- `index.ts` — lifecycle hooks, mode status, and guarded tool interception
- `command.ts` — `/permissions` UI flow and rule persistence
- `components/prompt.ts` — permission prompt UI component
- `components/rules-list.ts` — editable rules list UI
- `helpers.ts` — permission check derivation, labels, and mode override parsing
- `resolution.ts` — scope precedence, rule matching, path expansion, and default policy
- `expression.ts` — file, shell, and URL expression normalization
- `piignore.ts` — `.piignore` parsing, caching, and match resolution
- `storage.ts` — rule storage and agent mode persistence
- `constants.ts` — scopes, guarded tools, and suspicious shell patterns
- `types.ts` — rule, scope, check, and display types

## Data and persistence

- `.pi/permissions.json` in project scope
- global `~/.pi/agent/permissions.json` in home scope
- mode stored through the settings path used by `writeAgentMode` and `readAgentMode`

Stored rule categories:

- `file`
- `web`
- `bash`

Stored scopes:

- `session`
- `project`
- `always`

## Dependencies and integration

- `agent` loads the runtime policy ceiling from the active agent metadata
- `subsession` reuses `askForPermission` during child-session handoff
- `cleanup` prunes stale session-scoped rules
- `web_fetch` passes through this extension as a guarded web tool

## Edge cases and guardrails

- `.piignore` blocking occurs before permission resolution
- a blocked runtime ceiling from agent metadata stops the request before stored rules matter
- suspicious shell patterns still prompt even if an existing rule would otherwise allow the request
- the resize listener for the status line is detached on shutdown
- non-UI contexts cannot use `/permissions`

## Manual test checklist

- allow a file read inside the repository and verify that later requests do not prompt again
- try file access outside the repository and verify that a prompt appears
- add a deny rule for a shell command pattern
- trigger a suspicious shell command and verify the danger-prompt path
- add a `.piignore` entry and verify that a matching path is blocked
- toggle YOLO mode on and off and verify that prompts disappear and then return
