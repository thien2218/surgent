import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Parser from "tree-sitter";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { buildCallTree } from "../tracer/tree.js";
import { useGrammarCache } from "../../../../test/helpers/languages.js";
import { createWorkspace } from "../../../../test/helpers/workspace.js";

useGrammarCache();

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "surgent-tracer-"));
  onTestFinished(() => rm(cwd, { recursive: true, force: true }));
});

async function source(path: string, text: string) {
  await mkdir(join(cwd, path, ".."), { recursive: true });
  await writeFile(join(cwd, path), text);
}

describe("heuristic call trees", () => {
  it("keeps shared branches, deduplicates call sites, and stops only ancestor cycles", async () => {
    await source("main.ts", [
      "function root() { left(); left(); right(); }",
      "function left() { shared(); }",
      "function right() { shared(); }",
      "function shared() { root(); }",
    ].join("\n"));

    const text = await buildCallTree(cwd, { mode: "outgoing", file: "main.ts", symbol: "root" });

    expect(text).toBe([
      "Files:", "F1 - main.ts", "", "Tree:", "root (F1 L1-L1) (outgoing)",
      "├─ left (F1 L2-L2)", "│  └─ shared (F1 L4-L4)", "│     └─ root (F1 L1-L1) [cycle]",
      "└─ right (F1 L3-L3)", "   └─ shared (F1 L4-L4)", "      └─ root (F1 L1-L1) [cycle]",
      "", "Heuristic results; maxDepth 3. Module-level calls excluded.",
    ].join("\n"));
  });

  it("counts maxDepth in edges and defaults to three", async () => {
    await source("main.ts", [
      "function root() { first(); }", "function first() { second(); }",
      "function second() { third(); }", "function third() { fourth(); }", "function fourth() {}",
    ].join("\n"));

    const defaults = await buildCallTree(cwd, { mode: "outgoing", file: "main.ts", symbol: "root" });
    const shallow = await buildCallTree(cwd, { mode: "outgoing", file: "main.ts", symbol: "root", maxDepth: 1 });

    expect(defaults).toContain("third (F1 L4-L4)");
    expect(defaults).not.toContain("fourth (");
    expect(shallow).toContain("first (F1 L2-L2)");
    expect(shallow).not.toContain("second (");
  });

  it("follows incoming aliases across files but excludes module-level and ignored callers", async () => {
    execFileSync("git", ["init", "-q"], { cwd });
    await source("target.ts", "export function finish() {}");
    await source("caller.ts", 'import { finish as done } from "./target.js";\nexport function run() { done(); }\ndone();');
    await source("entry.ts", 'import { run } from "./caller";\nfunction start() { run(); }');
    await source(".gitignore", "ignored.ts\n");
    await source("ignored.ts", 'import { finish } from "./target";\nfunction ignored() { finish(); }');

    const text = await buildCallTree(cwd, { mode: "incoming", file: "target.ts", symbol: "finish" });

    expect(text).toContain("F1 - target.ts\nF2 - caller.ts\nF3 - entry.ts");
    expect(text).toContain("└─ run (F2 L2-L2)\n   └─ start (F3 L2-L2)");
    expect(text).not.toContain("ignored");
    expect(text).not.toContain("(module)");
  });

  it("resolves default, namespace, and explicitly re-exported function and class aliases", async () => {
    await source("utils.ts", "export default function check() {}\nexport function hash() {}\nexport class Tools { static run() { hash(); } }");
    await source("barrel.ts", 'export { hash as digest, Tools as Helpers } from "./utils.js";');
    await source("main.ts", [
      'import verify from "./utils.js";', 'import { digest as compute, Helpers } from "./barrel";',
      'import * as utils from "./utils";', "function root() { verify(); compute(); Helpers.run(); utils.hash(); }",
    ].join("\n"));

    const text = await buildCallTree(cwd, { mode: "outgoing", file: "main.ts", symbol: "root" });

    expect(text).toContain("check (F2 L1-L1)");
    expect(text).toContain("hash (F2 L2-L2)");
    expect(text).toContain("Tools.run (F2 L3-L3)");
    expect(text).not.toContain("unresolved");
  });

  it("resolves Python relative and workspace imports, including module aliases", async () => {
    await source("pkg/helpers.py", "def hash_value():\n    pass\n");
    await source("pkg/main.py", [
      "from .helpers import hash_value as digest", "import pkg.helpers as helpers", "import pkg.helpers",
      "def root():", "    digest()", "    helpers.hash_value()", "    pkg.helpers.hash_value()",
    ].join("\n"));

    const text = await buildCallTree(cwd, { mode: "outgoing", file: "pkg/main.py", symbol: "root" });

    expect(text).toContain("└─ hash_value (F2 L1-L2)");
    expect(text).not.toContain("unresolved");
  });

  it("does not mistake a function-local Python import for a same-file function", async () => {
    await source("main.py", "def helper():\n    pass\ndef root():\n    from other import helper\n    helper()");
    await source("other.py", "def helper():\n    pass");

    const text = await buildCallTree(cwd, { mode: "outgoing", file: "main.py", symbol: "root" });

    expect(text).toContain("No callees resolved heuristically.");
    expect(text).toContain("1 unresolved call(s)");
  });

  it("resolves Python package submodules when an initializer also exists", async () => {
    await source("pkg/__init__.py", "");
    await source("pkg/helpers.py", "def run():\n    pass");
    await source("pkg/main.py", "from . import helpers\ndef root():\n    helpers.run()");

    const text = await buildCallTree(cwd, { mode: "outgoing", file: "pkg/main.py", symbol: "root" });

    expect(text).toContain("└─ run (F2 L1-L2)");
    expect(text).not.toContain("unresolved");
  });

  it.each([false, true])("does not resolve class-qualified instance methods (imported: %s)", async (imported) => {
    const declaration = "export class Service { save() {} static run() {} }";
    await source("main.ts", imported ? 'import { Service } from "./service";\nfunction root() { Service.save(); Service.run(); }' :
      `${declaration}\nfunction root() { Service.save(); Service.run(); }`);
    if (imported) await source("service.ts", declaration);

    const text = await buildCallTree(cwd, { mode: "outgoing", file: "main.ts", symbol: "root" });

    expect(text).toContain("Service.run (");
    expect(text).not.toContain("Service.save (");
    expect(text).toContain("1 unresolved call(s)");
  });

  it("does not invent edges for shadowed names, dynamic receivers, or ambiguous declarations", async () => {
    await source("main.ts", [
      "function helper() {}", "function duplicate() {}", "function duplicate() {}",
      "class Service { save() {} }", "function root(helper: () => void, service: Service) {",
      "  helper(); service.save(); duplicate(); make().save();", "}",
    ].join("\n"));
    await source("unrelated.ts", "function make() {}\nfunction save() {}");

    const text = await buildCallTree(cwd, { mode: "outgoing", file: "main.ts", symbol: "root" });

    expect(text).toContain("No callees resolved heuristically.");
    expect(text).toContain("5 unresolved call(s)");
    expect(text).not.toContain("├─");
    expect(text).not.toContain("└─");
  });

  it("uses inspect duplicate names for roots without arbitrarily resolving duplicate callees", async () => {
    await source("main.ts", "function duplicate() {}\nfunction duplicate() { leaf(); }\nfunction leaf() {}");

    const text = await buildCallTree(cwd, { mode: "outgoing", file: "main.ts", symbol: "duplicate#1" });

    expect(text).toContain("duplicate#1 (F1 L2-L2) (outgoing)");
    expect(text).toContain("└─ leaf (F1 L3-L3)");
  });

  it("attributes unsupported nested function calls to the nearest supported callable", async () => {
    await source("main.ts", "function root() { function nested() { leaf(); } }\nfunction leaf() {}");

    const text = await buildCallTree(cwd, { mode: "outgoing", file: "main.ts", symbol: "root" });

    expect(text).toContain("└─ leaf (F1 L2-L2)");
    expect(text).not.toContain("nested (");
  });

  it("accepts function-valued declarations and resolves explicit same-container methods", async () => {
    await source("main.ts", "const leaf = () => {};\nclass Service { root() { this.save(); } save() { leaf(); } }");

    const text = await buildCallTree(cwd, { mode: "outgoing", file: "main.ts", symbol: "Service.root" });

    expect(text).toContain("└─ Service.save (F1 L2-L2)\n   └─ leaf (F1 L1-L1)");
  });

  it("assigns file IDs in breadth-first discovery order rather than rendering order", async () => {
    await source("root.ts", 'import { first } from "./a"; import { second } from "./b";\nfunction root() { first(); second(); }');
    await source("a.ts", 'import { leaf } from "./c";\nexport function first() { leaf(); }');
    await source("b.ts", "export function second() {}");
    await source("c.ts", "export function leaf() {}");

    const text = await buildCallTree(cwd, { mode: "outgoing", file: "root.ts", symbol: "root" });

    expect(text).toContain("F1 - root.ts\nF2 - a.ts\nF3 - b.ts\nF4 - c.ts");
    expect(text).toContain("├─ first (F2 L2-L2)\n│  └─ leaf (F4 L1-L1)\n└─ second (F3 L1-L1)");
  });

  it("reports unavailable parsers as partial results instead of claiming a complete empty search", async () => {
    const workspace = await createWorkspace({ prefix: "surgent-missing-parser-" });
    const modules = join(workspace.home, ".pi", "agent", "grammars", "node_modules");
    await mkdir(modules, { recursive: true });
    await symlink(resolve(import.meta.dirname, "../../../../node_modules/tree-sitter-typescript"),
      join(modules, "tree-sitter-typescript"), "junction");
    await source("main.ts", "function root() {}");
    await source("missing.py", "def unavailable():\n    pass");

    const text = await buildCallTree(cwd, { mode: "incoming", file: "main.ts", symbol: "root" });

    expect(text).toContain("Partial search:");
    expect(text).toContain("No callers resolved heuristically.");
  });

  it("bounds wide trees and explicitly reports truncation", async () => {
    const names = Array.from({ length: 510 }, (_entry, index) => `leaf${index}`);
    await source("main.ts", `function root() { ${names.map((name) => `${name}();`).join(" ")} }\n` +
      names.map((name) => `function ${name}() {}`).join("\n"));

    const text = await buildCallTree(cwd, { mode: "outgoing", file: "main.ts", symbol: "root", maxDepth: 1 });

    expect(text).toContain("Tree truncated at 500 nodes.");
    expect(text.match(/[├└]─/g)).toHaveLength(499);
  });

  it("bounds indentation in deep trees independently of the node cap", async () => {
    await source("main.ts", Array.from({ length: 300 }, (_entry, index) =>
      `function step${index}() { ${index < 299 ? `step${index + 1}();` : ""} }`).join("\n"));

    const text = await buildCallTree(cwd, { mode: "outgoing", file: "main.ts", symbol: "step0", maxDepth: 300 });

    expect(text).toContain("Tree truncated to fit 32 KiB output budget.");
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(32 * 1024);
  });

  it("rejects a root label that exceeds the output budget on its own", async () => {
    const name = `root${"Long".repeat(10_000)}`;
    await source("main.ts", `function ${name}() {}`);

    await expect(buildCallTree(cwd, { mode: "outgoing", file: "main.ts", symbol: name }))
      .rejects.toThrow("root symbol/path exceeds 32 KiB output budget");
  });

  it("does not claim no calls were resolved when the first child exceeds the remaining budget", async () => {
    const root = `root${"Long".repeat(5_000)}`;
    const leaf = `leaf${"Long".repeat(5_000)}`;
    await source("main.ts", `function ${root}() { ${leaf}(); }\nfunction ${leaf}() {}`);

    const text = await buildCallTree(cwd, { mode: "outgoing", file: "main.ts", symbol: root });

    expect(text.includes("Tree truncated to fit 32 KiB output budget.")).toBe(true);
    expect(text.includes("No callees resolved heuristically.")).toBe(false);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(32 * 1024);
  });

  it.each([
    [".ts", "function root() { leaf(); }\nfunction leaf() {}", "root", "leaf"],
    [".py", "def root():\n    leaf()\ndef leaf():\n    pass", "root", "leaf"],
    [".go", "package main\nfunc root() { leaf() }\nfunc leaf() {}", "root", "leaf"],
    [".java", "class Demo { static void root() { leaf(); } static void leaf() {} }", "Demo.root", "Demo.leaf"],
    [".rs", "fn root() { leaf(); }\nfn leaf() {}", "root", "leaf"],
    [".c", "void leaf(void) {}\nvoid root(void) { leaf(); }", "root", "leaf"],
    [".cpp", "void leaf() {}\nvoid root() { leaf(); }", "root", "leaf"],
    [".cs", "class Demo { static void Root() { Leaf(); } static void Leaf() {} }", "Demo.Root", "Demo.Leaf"],
    [".rb", "def root\n  leaf()\nend\ndef leaf\nend", "root", "leaf"],
    [".kt", "fun root() { leaf() }\nfun leaf() {}", "root", "leaf"],
    [".zig", "fn root() void { leaf(); }\nfn leaf() void {}", "root", "leaf"],
  ])("extracts ordinary calls using the %s grammar", async (extension, code, root, leaf) => {
    await source(`main${extension}`, code);

    const text = await buildCallTree(cwd, { mode: "outgoing", file: `main${extension}`, symbol: root });

    expect(text).toContain(`└─ ${leaf} (`);
    expect(text).not.toContain("unresolved");
  });

  it("rejects non-callable roots and unknown symbol names", async () => {
    await source("main.ts", "class Service {}\nconst value = 1;");

    await expect(buildCallTree(cwd, { mode: "incoming", file: "main.ts", symbol: "Service" }))
      .rejects.toThrow("symbol must be a function or method");
    await expect(buildCallTree(cwd, { mode: "incoming", file: "main.ts", symbol: "value" }))
      .rejects.toThrow("symbol must be a function or method");
    await expect(buildCallTree(cwd, { mode: "incoming", file: "main.ts", symbol: "missing" }))
      .rejects.toThrow("symbol not found");
  });

  it("honors cancellation before discovery", async () => {
    await expect(buildCallTree(cwd, { mode: "incoming", file: "main.ts", symbol: "root" }, AbortSignal.abort()))
      .rejects.toThrow(/abort/i);
  });

  it("stops when cancellation arrives during parsing rather than returning a partial tree", async () => {
    await source("main.ts", "function root() { leaf(); }\nfunction leaf() {}");
    const controller = new AbortController();
    const parse = Parser.prototype.parse;
    const parser = vi.spyOn(Parser.prototype, "parse").mockImplementation(function (this: Parser, input, oldTree, options) {
      const tree = parse.call(this, input, oldTree, options);
      controller.abort();
      return tree;
    });
    onTestFinished(() => parser.mockRestore());

    await expect(buildCallTree(cwd, { mode: "outgoing", file: "main.ts", symbol: "root" }, controller.signal))
      .rejects.toThrow(/abort/i);
  });
});
