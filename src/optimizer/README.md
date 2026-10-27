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

The first time you start Pi in a Git repository with supported code, pi-optimizer asks to download code parsers for the languages it finds. Your answer is remembered for that repository.

> **Using surgent?** pi-optimizer is already included. Do not install it separately, or the same tools will be registered twice.

## How it saves context

Your session history is never rewritten. pi-optimizer formats tool output more compactly as it is produced, and trims what the model sees on later requests.

### Read code by structure, not by file

Agents often read a whole file to find one function. pi-optimizer gives the agent an outline first: the functions, classes, and methods in a file or folder, with the lines where each one lives.

```text
src/web-tools/web-fetch/helpers.ts
  [deps] <imports>
  [public func] toCanonicalUrl L10-L17
  [public func] getValidatedUrl L52-L66
```

From the outline, the agent can fetch just the function it needs, or only its signature, instead of the whole file. Folder outlines skip files excluded by your `.gitignore`.

The agent uses this through the `code_map` and `inspect` tools. Supported languages are TypeScript, JavaScript, Python, Go, Java, and Rust.

### Patch edits for GPT models

GPT models are trained to edit code with patches. The `patch` tool gives them that format: one patch that can add, update, move, and delete several files, so a change that would otherwise take several edit calls takes one:

```text
*** Begin Patch
*** Update File: src/app.py
@@ def greet():
-    print("Hi")
+    print("Hello")
*** Add File: docs/hello.txt
+Hello
*** End Patch
```

Every file in the patch is checked before anything is written, so a patch that does not match leaves all files unchanged. If a write fails partway, files already written are restored. Updated files keep their line endings and byte order mark.

In surgent, GPT models get `patch` in place of `edit` and `write` when the agent is allowed to write files; other models keep `edit` and `write`. In Pi, `patch` is available to every model alongside `edit` and `write`.

### Compact command output

When a command prints a run of lines that differ by a single value, those lines are merged into one. This output:

```text
request /health returned 204
request /health returned 404
request /health returned 500
```

reaches the model as:

```text
request /health returned {204, 404, 500}
```

Nothing is lost: the merged line keeps every value in order, and output is merged only when that makes it shorter.

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
