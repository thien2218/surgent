import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { collectSymbols } from "../../../../src/optimizer/grammar/index.js";
import { inspectSymbol } from "../../../../src/optimizer/inspector/inspect.js";
import { useGrammarCache } from "../../../helpers/languages.js";

useGrammarCache();

describe("leading symbol comments", () => {
  it.each([
    {
      name: "exported TypeScript function after leading blank lines",
      file: "main.ts",
      symbol: "greet",
      source: "\n\n/** Greet a user. */\nexport function greet() {\n  return 1;\n}\n",
      text: "/** Greet a user. */\nexport function greet() {\n  return 1;\n}",
      signature: "/** Greet a user. */\nexport function greet()",
      range: [3, 6],
    },
    {
      name: "variable-bound TypeScript function",
      file: "main.ts",
      symbol: "greet",
      source: "/** Greet a user. */\nexport const greet = () => { return 1; };\n",
      text: "/** Greet a user. */\nexport const greet = () => { return 1; }",
      signature: "/** Greet a user. */\nexport const greet = ()",
      range: [1, 2],
    },
    {
      name: "TypeScript method with comments between decorators",
      file: "main.ts",
      symbol: "Service.run",
      source:
        "class Service {\n  /** Run a task. */\n  @first()\n  // Keep metadata.\n  @second()\n  run() { return 1; }\n}\n",
      text:
        "/** Run a task. */\n  @first()\n  // Keep metadata.\n  @second()\n  run() { return 1; }",
      signature:
        "/** Run a task. */\n  @first()\n  // Keep metadata.\n  @second()\n  run()",
      range: [2, 6],
    },
    {
      name: "Rust function with comments between attributes but not module documentation",
      file: "main.rs",
      symbol: "run",
      source:
        "//! Module documentation.\n/// Run a task.\n#[inline]\n/// More detail.\n#[must_use]\npub fn run() -> i32 {\n    1\n}\n",
      text:
        "/// Run a task.\n#[inline]\n/// More detail.\n#[must_use]\npub fn run() -> i32 {\n    1\n}",
      signature:
        "/// Run a task.\n#[inline]\n/// More detail.\n#[must_use]\npub fn run() -> i32",
      range: [2, 8],
    },
    {
      name: "Java method with an annotation",
      file: "Main.java",
      symbol: "Service.run",
      source:
        "class Service {\n  /** Run a task. */\n  @Override\n  void run() { return; }\n}\n",
      text: "/** Run a task. */\n  @Override\n  void run() { return; }",
      signature: "/** Run a task. */\n  @Override\n  void run()",
      range: [2, 4],
    },
    {
      name: "C# method with an attribute",
      file: "Main.cs",
      symbol: "Service.Run",
      source:
        "class Service {\n  /// <summary>Run a task.</summary>\n  [Obsolete]\n  void Run() { return; }\n}\n",
      text: "/// <summary>Run a task.</summary>\n  [Obsolete]\n  void Run() { return; }",
      signature: "/// <summary>Run a task.</summary>\n  [Obsolete]\n  void Run()",
      range: [2, 4],
    },
    {
      name: "Python function with a decorator",
      file: "main.py",
      symbol: "greet",
      source: '# Greet a user.\n@cache\ndef greet():\n    """Body documentation."""\n    return 1\n',
      text: '# Greet a user.\n@cache\ndef greet():\n    """Body documentation."""\n    return 1',
      signature: "# Greet a user.\n@cache\ndef greet():",
      range: [1, 5],
    },
    {
      name: "C++ method with a template wrapper",
      file: "main.cpp",
      symbol: "Box.put",
      source:
        "template <typename Value>\nclass Box {\npublic:\n  /** Store a value. */\n  template <typename Item>\n  void put(Item item) { return; }\n};\n",
      text: "/** Store a value. */\n  template <typename Item>\n  void put(Item item) { return; }",
      signature: "/** Store a value. */\n  template <typename Item>\n  void put(Item item)",
      range: [4, 6],
    },
    {
      name: "TypeScript import group",
      file: "main.ts",
      symbol: "(imports)",
      source: '/** Dependencies. */\nimport "first";\n// Next dependency.\nimport "second";\n',
      text: '/** Dependencies. */\nimport "first";\n// Next dependency.\nimport "second";',
      signature: '/** Dependencies. */\nimport "first";\n// Next dependency.\nimport "second";',
      range: [1, 4],
    },
  ])("includes attached comments in source, signatures, and map ranges for $name", async (testCase) => {
    const cwd = await mkdtemp(join(tmpdir(), "surgent-comments-"));
    onTestFinished(() => rm(cwd, { recursive: true, force: true }));
    await writeFile(join(cwd, testCase.file), testCase.source);

    expect((await inspectSymbol(cwd, testCase.file, testCase.symbol))?.text).toBe(testCase.text);
    expect((await inspectSymbol(cwd, testCase.file, testCase.symbol, true))?.text).toBe(
      testCase.signature,
    );
    expect((await collectSymbols(cwd, testCase.file)).find(({ name }) => name === testCase.symbol)?.range).toEqual(
      testCase.range,
    );
  });

  it.each([
    {
      name: "a detached block comment",
      file: "main.ts",
      source: "/** Detached. */\n \nfunction greet() {}\n",
      text: "function greet() {}",
    },
    {
      name: "a detached Rust line comment that includes its newline",
      file: "main.rs",
      source: "/// Detached.\n\nfn greet() {}\n",
      text: "fn greet() {}",
    },
    {
      name: "a previous declaration's trailing comment",
      file: "main.ts",
      source: "const previous = 1; // Previous documentation.\nfunction greet() {}\n",
      text: "function greet() {}",
    },
    {
      name: "a trailing comment before attached documentation",
      file: "main.ts",
      source: "const previous = 1; // Previous documentation.\n/** Greet a user. */\nfunction greet() {}\n",
      text: "/** Greet a user. */\nfunction greet() {}",
    },
    {
      name: "a detached comment with CRLF endings",
      file: "main.ts",
      source: "/** Detached. */\r\n\r\nfunction greet() {}\r\n",
      text: "function greet() {}",
    },
  ])("excludes $name", async ({ file, source, text }) => {
    const cwd = await mkdtemp(join(tmpdir(), "surgent-comments-"));
    onTestFinished(() => rm(cwd, { recursive: true, force: true }));
    await writeFile(join(cwd, file), source);

    expect((await inspectSymbol(cwd, file, "greet"))?.text).toBe(text);
  });
});
