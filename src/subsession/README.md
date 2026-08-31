# subsession

## Purpose

The `subsession` module runs persistent child `AgentSession` instances for planner, reviewer, and delegated workflows. Child sessions use Pi SDK directly and keep their JSONL history under `.pi/subsessions/`.

## Public surface

- `runSubsession`
- `renderSnapshotWidget`

## How it works

1. Parent creates or opens a `SessionManager` in `.pi/subsessions/`.
2. `createAgentSession` creates a child around that persistent session.
3. Child profile provides its system prompt, model, thinking level, and tool allowlist.
4. SDK events update tool, token, and status snapshots.
5. Parent can call `Subsession.exec()` to continue same child history.
6. `dispose()` closes only live SDK resources; session history remains resumable.

## Child isolation

Child sessions use a controlled resource loader. An inline bridge supplies questionnaire and permission UI through the parent context, applies child agent rules and `.piignore`, and blocks recursive `subagent` calls.

## Persistence

- `.pi/subsessions.json` stores label, parent session ID, title, and usage.
- `.pi/subsessions/` stores Pi child session JSONL files.

Existing session files remain compatible because both implementations use Pi `SessionManager` files.
