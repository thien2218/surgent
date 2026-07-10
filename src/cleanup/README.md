# cleanup

## Purpose

The `cleanup` extension prunes stale `.pi` state tied to sessions or subsessions that no longer exist.

## Public surface

Hook:

- `session_start`

This extension does not register commands or tools.

## How it works

1. On session start, the extension lists the normal sessions.
2. It lists the subsessions from the subsession session directory.
3. It builds a live session ID set and a combined session and subsession ID set.
4. It starts best-effort cleanup tasks in the background for:
   - permission records
   - checkpoint store entries
   - session-agent mappings
   - checkpoint stash references
   - orphaned subsession files
5. Cleanup failures are ignored so that startup remains non-blocking.

## Key files

- `index.ts` — startup trigger and live session ID collection
- `helpers.ts` — generic pruning for session-ID keyed JSON maps
- `permission.ts` — removal of dead permission scopes from local and global storage
- `stash.ts` — deletion of stale checkpoint stash entries
- `subsession.ts` — deletion of orphaned subsession metadata and session files

## Data and persistence

This extension touches shared state owned by other parts of the system:

- `.pi/checkpoints.json`
- `.pi/agents.json`
- `.pi/permissions.json`
- `.pi/subsessions.json`
- `.pi/subsessions/`
- git stash entries used by `checkpoint`

## Dependencies and integration

- depends on `SessionManager` to discover live sessions
- is tightly coupled with `checkpoint`, `permission`, `subsession`, and `agent`
- runs early so that later extensions see less stale state

## Edge cases and guardrails

- cleanup is intentionally fire-and-forget
- failures are swallowed by design
- local and global permission stores are cleaned separately
- subsession cleanup preserves child sessions only when the parent session still exists

## Manual test checklist

- create temporary session-linked permission and checkpoint data
- delete or invalidate the owning session
- start a new session
- verify that stale entries disappear from the store files
- verify that startup still succeeds if a cleanup helper throws
