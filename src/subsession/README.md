# subsession

## Purpose

The `subsession` module runs reusable child `surgent` sessions for planner, reviewer, and similar delegated workflows. It also bridges pending child interactions back into the parent UI.

## Public surface

Exports:

- `runSubsession`
- `createResumeInput`
- `emitInteractionHandoff`
- `resolveInteractionHandoff`
- `renderSnapshotWidget`

Environment flags:

- `SURGENT_SUBSESSION`
- `SURGENT_SUBAGENT`

This module does not register direct commands or tools on its own.

## How it works

1. A parent flow builds a `SubsessionRequest` with the agent, label, input, and optional model.
2. `runSubsession` resolves the runtime configuration and either:
   - creates a new child session from input
   - resumes an existing child session by ID
3. A new child session runs through a spawned `surgent` process in JSON mode.
4. Stdout JSON lines are streamed through a parser into evolving snapshot state.
5. The snapshot widget shows the title, status, tool usage, and token usage while the child runs.
6. When the child stops, the result becomes one of:
   - `done`
   - `aborted`
   - `error`
   - `pending`
7. `pending` means that the child emitted an interaction handoff through stderr marker text.
8. The parent resolves the handoff and feeds serialized resume input back into the child.

### Handoff types

Current handoff support covers:

- `questionnaire`
- permission prompts for permissive tools

For permission handoff, the parent session prompts the user, may persist an allow rule for the child session, and then tells the child to retry the tool call.

## Key files

- `index.ts` — public exports and subsession environment flags
- `execute.ts` — run/resume orchestration and child-process lifecycle
- `parser.ts` — JSON line parser for child output events
- `helpers.ts` — handoff encoding, resume payload, title extraction, widget rendering, and invoker resolution
- `storage.ts` — metadata store, output loading, runtime resolution, and termination helpers
- `types.ts` — request, result, runtime, usage, and interaction types

## Data and persistence

- `.pi/subsessions.json` — subsession metadata store
- `.pi/subsessions/` — subsession session files

Stored metadata includes:

- label
- parent session ID
- title
- usage totals

## Dependencies and integration

- serves as the backbone for the `commands` planner and reviewer workflows
- permission handoff reuses `permission.askForPermission`
- questionnaire handoff reuses the `questionnaire` UI helpers
- `cleanup` removes orphaned subsession metadata and files
- `agent` reads the environment flags to apply stricter child-session tool restrictions

## Edge cases and guardrails

- resuming a missing subsession yields a synthetic error result instead of a crash
- the abort signal sends `SIGTERM` first, then `SIGKILL` after a timeout
- child stderr errors are still captured when the parser has no final assistant message
- `pending` is an explicit state whenever a handoff exists

## Manual test checklist

- start a new planner or reviewer subsession
- resume a stored subsession by ID
- trigger a questionnaire from a child flow and verify that the parent UI handles it
- trigger a permission request from a child flow and verify that the retry path works
- abort a child session and verify that the status becomes `aborted`
