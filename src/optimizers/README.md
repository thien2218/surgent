# optimizers

## Purpose

The `optimizers` extension reduces token consumption and provides narrower, code-aware inspection primitives.

## Public surface

Tools:

- `code_map`
- `inspect`

Hooks:

- `session_start` grammar bootstrap
- `context` pruning
- `tool_result` summarization for `grep` and `bash`
- `agent_end` summary persistence and session-tail rewrite
- `session_tree` active summary rebuild

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

### 5. Context pruning

- prunes bulky tool-result content before messages reach the model when that is safe to do so

## Key files

- `index.ts` — extension composition root
- `languages/` — grammar installation, parser setup, language registry, and symbol extraction
- `mapper/index.ts` — `code_map` tool
- `mapper/files.ts` — target resolution and repository file discovery
- `inspector/index.ts` — `inspect` tool
- `inspector/inspect.ts` — symbol lookup
- `inspector/extract.ts` — depth-based collapse logic
- `truncator/index.ts` — grep and bash summary capture plus rewrite flow
- `truncator/extractors.ts` — summary extraction from tool results
- `truncator/helpers.ts` — session-file rewrite helpers
- `pruner/index.ts` — context message pruning

## Data and persistence

- `.pi/grammars/` — cached tree-sitter language packages
- custom persisted session entries for summary state
- session file tail rewrites for compact historical tool output

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

## Manual test checklist

- run `code_map` on a TypeScript path and verify the symbol ranges
- run `inspect` on a mapped symbol with and without `depth`
- run `grep` or `bash` and verify that later context shows the summary instead of the raw output
- start a fresh session and verify that grammar installation does not block startup
