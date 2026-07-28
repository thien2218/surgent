# optimizers

## Purpose

The `optimizers` extension reduces token consumption and provides narrower, code-aware inspection primitives.

## Public surface

Tools:

- `code_map`
- `inspect`

Hooks:

- `session_start` grammar bootstrap and deduplicator reset
- `context` pruning
- `tool_result` summarization for `grep` and `bash`
- `tool_result` read/inspect deduplication
- `agent_end` summary persistence and session-tail rewrite
- `session_shutdown` persisted context pruning and failed-call cleanup
- `session_tree` active summary rebuild, pruner state reload, and deduplicator reset

## How it works

This extension is a composition root for several token-saving capabilities.

### 1. Grammar bootstrap

On session start, `languages/` ensures that the tree-sitter grammar cache exists for the supported language buckets.

Current registry:

- TypeScript
- Python
- Go
- Java

### 2. `code_map`

- resolves file targets or globs
- rejects unsupported extensions early
- extracts symbols with line ranges
- clamps imports into one combined import range
- returns compact map output suitable for later `inspect` calls or ranged reads

### 3. `inspect`

- looks up one exact symbol in one file
- returns the full body by default
- can collapse nested blocks when `depth` is provided
- returns the exact line range in the result details for targeted edits

### 4. Tool-result compaction

- captures `grep` and `bash` results
- extracts compact summary text
- rewrites the run tail after the agent finishes
- stores summaries in a custom session entry
- later `context` hooks replace historical full output with the summary

### 5. Read/inspect deduplication

- tracks source line ranges already returned by `read` and `inspect`
- remaps tracked ranges after line insertions and deletions
- returns only unseen or changed ranges with two surrounding context lines
- preserves collapsed `inspect` ranges so deeper inspection can reveal hidden source

### 6. Context pruning

On session shutdown, the pruner rewrites persisted session history:

- removes failed non-`bash` tool calls and results
- marks an earlier `inspect` result as repeated by the latest result for the same canonical path and symbol, regardless of inspection depth
- marks an earlier `read` result as repeated only when later reads fully cover its line range
- restores full original content for retained replacement results that read/inspect deduplication had shortened

Repeated results store replacement entry IDs in `details.repeat`. On session start or tree navigation, the pruner rebuilds state for the active branch. Before each model call, the `context` hook removes a repeated tool call and result only when every replacement entry exists on that branch.

Pruning runs at shutdown rather than during the active session to preserve cache-friendly context. It is intentionally lossy: later shallow inspections can replace deeper inspections, and removed failed calls do not remain in persisted history. Later successful tool calls are expected to provide better context than failed attempts.

## Key files

- `index.ts` — extension composition root
- `languages/` — grammar installation, parser setup, language registry, and symbol extraction
- `mapper/index.ts` — `code_map` tool
- `mapper/files.ts` — target resolution and repository file discovery
- `inspector/index.ts` — `inspect` tool
- `inspector/inspect.ts` — symbol lookup
- `inspector/extract.ts` — depth-based collapse logic and visible source ranges
- `deduplicator/` — in-memory read/inspect range tracking and result filtering
- `truncator/index.ts` — grep and bash summary capture plus rewrite flow
- `truncator/extractors.ts` — summary extraction from tool results
- `truncator/helpers.ts` — session-file rewrite helpers
- `pruner/index.ts` — pruning lifecycle hooks
- `pruner/prune.ts` — repeated read/inspect detection and replacement links
- `pruner/cleanup.ts` — failed-call removal and session-tree repair
- `pruner/context.ts` — active-branch state and outgoing context filtering

## Data and persistence

- `.pi/grammars/` — cached tree-sitter language packages
- in-memory file content and touched ranges for read/inspect deduplication
- custom persisted session entries for summary and failed-call state
- `details.repeat` links between repeated read/inspect results and their replacements
- session file rewrites for compact historical tool output and pruned history

## Dependencies and integration

- designed to pair with path-narrowed file tools and shared tool-use guidance
- `code_map` and `inspect` are central repository-understanding tools during agent sessions
- grammar bootstrap depends on runtime facilities rather than extension-owned configuration

## Edge cases and guardrails

- unsupported extensions return an explicit validation error
- target-scan failures are reported per file instead of crashing the entire result set
- grammar installation failure notifies the user but does not stop the session
- `inspect` returns friendly not-found guidance when symbol lookup misses
- summary rewrite runs only when tool summaries exist for the completed run
- repeated tool calls are removed from outgoing context only when all replacement entries remain on the active branch

## Manual test checklist

- run `code_map` on a TypeScript path and verify the symbol ranges
- run `inspect` on a mapped symbol with and without `depth`
- run `grep` or `bash` and verify that later context shows the summary instead of the raw output
  <<<<<<< HEAD
- # repeat `read` calls with full line-range coverage, shut down, resume, and verify that replaced calls are absent from model context
- repeat overlapping `read` calls, shut down, resume, and verify that replaced calls are absent from model context
  > > > > > > > 79fa70a917ab3589bbff926f9a612b290a4b6dd0
- inspect the same symbol at different depths, shut down, resume, and verify that only the latest inspection remains in model context
- run a failed non-`bash` tool call followed by a successful replacement, shut down, resume, and verify that the failed call is absent from persisted history
- start a fresh session and verify that grammar installation does not block startup
