# pi-optimizer

A [Pi](https://github.com/earendil-works/pi) extension that keeps your coding agent's context focused on the task.

In a long session, the model's context fills up with tool output that has stopped being useful: files read more than once, search results padded with surrounding lines, and failed commands. That clutter costs tokens and can pull the model's attention away from the code that matters. pi-optimizer cleans it up automatically and helps the agent read only the code it needs.

It is also built into [surgent](https://github.com/thien2218/surgent).

## Install

```bash
pi install npm:pi-optimizer
pi list
```

Then start or restart Pi in your project. Everything below works automatically; there is nothing to configure.

The first time you start Pi in a Git repository with supported code, pi-optimizer finds the repository's main languages, saves them as `languages` in `.pi/settings.json`, and asks to download code parsers for them. Your answer is remembered for that repository. To change which languages get parsers, edit that list using these names: `typescript`, `python`, `go`, `java`, `rust`, `c`, `cpp`, `csharp`, `ruby`, `kotlin`, `zig`.

> **Using surgent?** pi-optimizer is already included. Do not install it separately, or the same tools will be registered twice.

## How it saves context

Your session history is never rewritten. pi-optimizer formats tool output more compactly as it is produced, and trims what the model sees on later requests.

### Read code by structure, not by file

Agents often read a whole file to find one function. pi-optimizer gives the agent an outline first: the functions, classes, and methods in a file or folder, with the lines where each one lives.

```text
src/web-tools/web-fetch/helpers.ts
 [func] toCanonicalUrl L10-L17; getValidatedUrl L53-L67
```

From the outline, the agent can fetch just the function it needs, or only its signature, instead of the whole file. Folder outlines skip files excluded by your `.gitignore`.

The agent uses this through the `code_map` and `inspect` tools. They support these languages:

| Language | File extensions                              | Parser package                             |
| -------- | -------------------------------------------- | ------------------------------------------ |
| JS/TS    | `.ts` `.tsx` `.js` `.jsx` `.mjs` `.cjs`      | `tree-sitter-typescript`                   |
| Python   | `.py`                                        | `tree-sitter-python`                       |
| Go       | `.go`                                        | `tree-sitter-go`                           |
| Java     | `.java`                                      | `tree-sitter-java`                         |
| Rust     | `.rs`                                        | `tree-sitter-rust`                         |
| C        | `.c`                                         | `tree-sitter-c`                            |
| C++      | `.cpp` `.cc` `.cxx` `.h` `.hpp` `.hh` `.hxx` | `tree-sitter-cpp`                          |
| C#       | `.cs`                                        | `tree-sitter-c-sharp`                      |
| Ruby     | `.rb` `.rake` `.gemspec`                     | `tree-sitter-ruby`                         |
| Kotlin   | `.kt` `.kts`                                 | `@tree-sitter-grammars/tree-sitter-kotlin` |
| Zig      | `.zig`                                       | `@tree-sitter-grammars/tree-sitter-zig`    |

C headers (`.h`) are read with the C++ parser, which also understands C.

### Experimental call trees

The experimental `call_tree` tool follows callers (`incoming`) or callees (`outgoing`) of a function or method. Start with `code_map` or `inspect` to find the symbol's name.

```typescript
{ mode: 'incoming' | 'outgoing', symbol: string, file: string, maxDepth?: number }
```

- `mode`, `symbol`, and `file` are required. Only functions and methods are accepted.
- `symbol` uses existing `inspect` names, including `Type.member` and duplicate-name suffixes such as `#1`.
- `file` identifies the file containing the root symbol.
- `maxDepth` defaults to `3` and must be an integer of at least `1`. It counts edges from the root, not nodes.

The tool reads supported, non-ignored workspace files from disk without read-grant prompts. The root file is explicitly loaded even if it is ignored.

The tree is built breadth-first. A `Files:` table assigns IDs such as `F1` to paths; tree entries include those IDs and line ranges. For example, an outgoing tree might show:

```text
Files:
F1 - src/example.ts

Tree:
start (F1 L1-L5) (outgoing)
└─ run (F1 L7-L12)
   └─ start (F1 L1-L5) [cycle]
```

Repeated symbols on separate, noncyclic branches expand again. Only a return to an ancestor on the current branch gets `[cycle]` and stops expanding.

This is a Tree-sitter heuristic, not a complete usage search or impact analysis:

- Module-level calls are excluded. The nearest supported enclosing function or method owns each call; calls inside unsupported nested functions are attributed to that supported enclosing callable.
- Resolution is conservative: simple local calls and explicit same-file container, `self`, or `this` calls are supported across the existing parsers.
- TS/JS relative ES imports support default, namespace, and named imports with aliases, plus explicit aliased reexports, including classes. Python supports relative and workspace-root imports, including module aliases.
- Dynamic receivers, package/path aliases, wildcard exports, CommonJS, and other-language cross-file imports can remain unresolved.

Output reports unresolved calls in expanded symbols, skipped files or discovery errors, and truncation when encountered. Missing parsers or unreadable files can hide calls. A 500-node cap and a 32 KiB output budget limit the tree independently of `maxDepth`; no resolved callers or callees does not prove there are none.

### Patch edits for GPT models

GPT models are trained to edit code with patches. The `patch` tool gives them that format: one patch that can add, update, move, and delete several files, so a change that would otherwise take several edit calls takes one:

```text
*** Begin
*** Update: src/app.py
@@ def greet():
-    print("Hi")
+    print("Hello")
*** Add: docs/hello.txt
+Hello
*** End
```

Every file in the patch is checked before anything is written, so a patch that does not match leaves all files unchanged. If a write fails partway, files already written are restored. Updated files keep their byte order mark, and lines outside the patched regions keep their line endings.

In surgent, GPT models get `patch` in place of `edit` and `write` when the agent is allowed to write files; other models keep `edit` and `write`. In Pi, `patch` is available to every model alongside `edit` and `write`.

### Compact command output

Command output reaches the model as it would read in a terminal, without the clutter that only matters on screen:

- Colors and other terminal escape codes are removed.
- A line redrawn in place, such as a progress bar, keeps only its final state.
- Trailing spaces and tabs are trimmed.
- A line printed several times in a row appears once, followed by a note like `[above line repeated 12 more times]`. The note is used only when it is shorter than the repeats it replaces.

### Grouped search results

Search results are grouped under each file instead of repeating the file path on every matching line. These results:

```text
src/server.ts:12: const port = readPort();
src/server.ts:40: server.listen(port);
src/config.ts:8: export function readPort() {
```

reach the model as:

```text
src/server.ts
12: const port = readPort();
40: server.listen(port);
src/config.ts
8: export function readPort() {
```

### Clean up seen results when you resume

Once the model has seen a result and moved on, some of it stops being useful. When a session starts or resumes, pi-optimizer tidies up results the model has already replied to:

- Failed tool calls are removed, together with the call that produced them. Calls blocked before they ran, for example by a permission rule or a rejected prompt, are kept so the model remembers what was refused and why.
- Failed shell commands are kept, because their errors are often still relevant, until the same command runs again and its newer output replaces them.
- File searches and directory listings that found nothing are removed.
- Search results keep their matching lines but drop the surrounding context lines.

Results the model has not replied to yet are left intact. The cleanup is saved to the session, so it carries over to later resumes and forks. It runs only at session start, because editing earlier turns mid-session would make your model provider discard its cached copy of the conversation from that point on, costing more than the cleanup saves. Results produced during the session are cleaned up the next time you resume it.

### Skip outdated file contents when you resume

When a session starts or resumes, pi-optimizer looks back through the conversation, up to the last compaction, for file contents that have gone stale:

- If a file was later rewritten or read again in full, earlier reads, edits, and writes of that file are hidden from the model.
- If the agent looked up the same function more than once, only the latest lookup is kept.

This check runs when the session starts. Changes made during the session are picked up the next time you resume it.

## Requirements

- Node.js 22.19 or newer
- Pi
- npm, to download code parsers

## License

[MIT](LICENSE)
