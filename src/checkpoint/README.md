# checkpoint

## Purpose

The `checkpoint` extension keeps git-backed restore points for code-changing turns and offers to restore the worktree when the user moves to an older session tree entry or forks from an earlier point.

## Public surface

Hooks:

- `session_start`
- `tool_result` for `write` and `edit`
- `session_before_tree`
- `session_before_fork`
- `agent_end`

This extension does not register commands or tools.

## How it works

1. On session start, the extension loads the checkpoint store for the current session.
2. It rebuilds the in-memory mapping from entry IDs to checkpoint references.
3. It ensures that a base checkpoint exists for the current session.
4. After each successful `write` or `edit`, it creates a new git stash-backed checkpoint for the current leaf entry.
5. Before a tree jump or fork, it:
   - finds the checkpoint for the target entry
   - compares it with the checkpoint for the current entry
   - skips the prompt if both references are identical
   - asks the user whether the code should be restored
6. If the user accepts, the extension restores the worktree with `git restore --source=... --worktree .`.
7. On agent end, it persists the in-memory map back to `.pi/checkpoints.json`.

## Key files

- `index.ts` — store load and save logic, checkpoint lookup, and restore prompt flow
- `git.ts` — creation of stash-backed checkpoints and restoration of those checkpoints to the worktree

Important functions in `index.ts`:

- `readCheckpointStore`
- `ensureBaseCheckpoint`
- `findCheckpoint`
- `shouldOfferRestore`
- `restoreCheckpoint`

## Data and persistence

- `.pi/checkpoints.json` — session ID to entry ID to stash reference mapping
- git stash entries labeled with session and leaf entry IDs

## Dependencies and integration

- depends on a working git repository state
- `cleanup` prunes stale checkpoint records and checkpoint stash entries
- session tree and fork hooks tie this extension to the pi session manager lifecycle

## Edge cases and guardrails

- non-UI sessions skip the restore prompt entirely
- the restore prompt appears only when the target checkpoint differs from the current checkpoint
- a failed git restore notifies the user and cancels navigation
- a failed checkpoint creation returns no reference rather than crashing the session

## Manual test checklist

- edit a file in a session and confirm that checkpoint state persists after the turn
- branch the session tree, move back to an earlier node, and confirm that the restore prompt appears
- accept the restore and verify that the worktree rolls back
- decline the restore and verify that the current worktree remains intact
- simulate a git failure and verify that navigation is cancelled with an error notice
