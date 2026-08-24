# checkpoint

## Purpose

The `checkpoint` extension keeps isolated, git-backed restore points for code-changing turns. It offers to restore project files when the user moves to an older session tree entry or forks from an earlier point.

## Public surface

Hooks:

- `session_start`
- `tool_result` for `write` and `edit`
- `session_before_tree`
- `session_before_fork`
- `agent_end`
- `session_shutdown`

This extension does not register commands or tools.

## How it works

1. On session start, the extension resolves the project Git root and opens its shadow checkpoint repository.
2. The shadow repository lives at `~/.pi/agent/checkpoints/<project-hash>` and uses the project directory as its Git worktree.
3. On first use, it points its object database at the source repository, copies the source index when possible, and copies `.git/info/exclude` rules. If index copying fails, it seeds from `HEAD` instead.
4. It loads the current session's entry-ID-to-tree mapping from `entries.json` in the shadow repository.
5. If no base checkpoint exists, it stages current project state and records its Git tree hash.
6. After each `write` or `edit`, it stages changed tracked files and nonignored untracked files, then records a new tree hash for the current leaf entry.
7. Before a tree jump or fork, it finds the target and current checkpoints. If they differ, it asks whether to restore code state.
8. On restore, it loads the target tree into the shadow index, writes that index to the project worktree, and removes checkpointed files absent from the target tree.
9. On agent end and session shutdown, it saves the entry mapping. Session shutdown also runs `git gc --auto` in the shadow repository.

## Key files

- `index.ts` — Pi lifecycle hooks, session mapping, restore prompt, and persistence
- `git.ts` — shadow repository setup, source object/index seeding, Git execution, and GC
- `stage.ts` — finds changed files and stages eligible paths in batches
- `snapshot.ts` — creates referenced tree snapshots and restores tree state
- `store.ts` — validates, reads, writes, and resolves session checkpoint mappings

## Data and persistence

```text
~/.pi/agent/checkpoints/<sha256(project-git-root)>/
├── .git/
└── entries.json
```

- `entries.json` maps session IDs to session entry IDs and tree hashes.
- `refs/surgent/checkpoints/<tree-hash>` keeps each tree reachable so `git gc --auto` does not prune it.
- The project no longer uses `.pi/checkpoints.json` or Git stashes.

## Dependencies and integration

- Requires Git and a project Git repository.
- Shadow Git commands use `--git-dir` and `--work-tree`, so they do not change the user's branch, index, or stash list.
- Existing Git objects are reused through `objects/info/alternates`. Moving or deleting source Git metadata invalidates the shadow repository; it is rebuilt on next session start.
- Session tree and fork hooks connect checkpoint selection to Pi session history.

## Edge cases and guardrails

- Only `write` and `edit` create checkpoints. Bash commands do not.
- Ignored files are excluded through project ignore rules and copied `info/exclude` rules.
- Newly discovered untracked files larger than 2 MiB are excluded.
- Restore preserves ignored files and untracked files never captured by a checkpoint.
- Restore writes only project files represented by the shadow index; user Git index remains untouched.
- Non-UI sessions skip restore prompts.
- A failed restore shows an error and cancels tree navigation or forking.
- A source Git directory change discards old shadow state and starts a new checkpoint repository.

## Manual test checklist

- Edit tracked and small untracked files through the agent, restore an earlier tree entry, and confirm both restore.
- Change an ignored file, restore a checkpoint, and confirm the ignored file remains unchanged.
- Add an untracked file larger than 2 MiB, restore a checkpoint, and confirm that file remains unchanged.
- Compare `git diff --cached` before and after checkpoint creation and restoration; user index should not change.
- Branch the session tree, move to an earlier node, and confirm the restore prompt appears only when checkpoints differ.
- Decline restoration and confirm current project files remain intact.
- Simulate a shadow Git failure and confirm navigation is cancelled with an error notice.
