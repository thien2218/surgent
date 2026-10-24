import { describe, expect, it } from "vitest";
import {
  deriveNewContent,
  detectLineEnding,
  joinBom,
  normalizeToLF,
  parsePatch,
  restoreLineEndings,
  splitBom,
} from "../../../src/optimizer/patcher/patch.js";
import type { UpdateChunk } from "../../../src/optimizer/patcher/types.js";

const patch = (...lines: string[]) => ["*** Begin Patch", ...lines, "*** End Patch"].join("\n");
const chunk = (oldLines: string[], newLines: string[], extra: Partial<UpdateChunk> = {}) =>
  ({ oldLines, newLines, ...extra });

describe("patch parsing", () => {
  it("parses add, delete, update and move sections in order", () => {
    expect(parsePatch(patch(
      "*** Add File: new.txt", "+one", "+two",
      "*** Delete File: old.txt",
      "*** Update File: src/app.py", "*** Move to: src/main.py", "@@ def greet():", " keep", "-old", "+new",
    ))).toEqual([
      { type: "add", path: "new.txt", contents: "one\ntwo" },
      { type: "delete", path: "old.txt" },
      {
        type: "update", path: "src/app.py", movePath: "src/main.py",
        chunks: [{ oldLines: ["keep", "old"], newLines: ["keep", "new"], changeContext: "def greet():" }],
      },
    ]);
  });

  it.each([
    ["no begin marker", "*** Add File: a.txt\n+x\n*** End Patch"],
    ["no end marker", "*** Begin Patch\n*** Add File: a.txt\n+x"],
    ["end before begin", "*** End Patch\n*** Begin Patch"],
  ])("rejects a patch with %s", (_case, text) => {
    expect(() => parsePatch(text)).toThrow("Invalid patch format: missing Begin/End markers");
  });

  it.each([
    ["padded markers", "  *** Begin Patch  \n*** Delete File: a.txt\n  *** End Patch  "],
    ["a cat heredoc", `cat <<'EOF'\n${patch("*** Delete File: a.txt")}\nEOF`],
    ["a bare heredoc", `<<EOF\n${patch("*** Delete File: a.txt")}\nEOF`],
    ["CRLF line endings", patch("*** Delete File: a.txt").replaceAll("\n", "\r\n")],
  ])("accepts %s", (_case, text) => {
    expect(parsePatch(text)).toEqual([{ type: "delete", path: "a.txt" }]);
  });

  it("strips carriage returns from CRLF patch lines", () => {
    const text = patch("*** Add File: a.txt", "+one", "*** Update File: b.txt", "@@", "-old", "+new").replaceAll("\n", "\r\n");

    expect(parsePatch(text)).toEqual([
      { type: "add", path: "a.txt", contents: "one" },
      { type: "update", path: "b.txt", chunks: [{ oldLines: ["old"], newLines: ["new"] }] },
    ]);
  });

  it("returns no hunks for an empty envelope", () => {
    expect(parsePatch(patch())).toEqual([]);
  });

  it("skips headers without a path", () => {
    expect(parsePatch(patch("*** Add File:   ", "+x", "*** Delete File: b.txt")))
      .toEqual([{ type: "delete", path: "b.txt" }]);
  });

  it("keeps only + lines as added content, including empty ones", () => {
    expect(parsePatch(patch("*** Add File: a.txt", "+one", "ignored", "+", "+two")))
      .toEqual([{ type: "add", path: "a.txt", contents: "one\n\ntwo" }]);
    expect(parsePatch(patch("*** Add File: empty.txt")))
      .toEqual([{ type: "add", path: "empty.txt", contents: "" }]);
  });

  it("splits update chunks at each @@ and ignores unprefixed lines", () => {
    expect(parsePatch(patch(
      "*** Update File: a.txt", "ignored before chunk", "@@ first", "-a", "+b", "unprefixed", "@@", " c", "-d",
    ))).toEqual([{
      type: "update", path: "a.txt",
      chunks: [
        { oldLines: ["a"], newLines: ["b"], changeContext: "first" },
        { oldLines: ["c", "d"], newLines: ["c"] },
      ],
    }]);
  });

  it("marks a chunk ending at *** End of File and keeps parsing later sections", () => {
    expect(parsePatch(patch(
      "*** Update File: a.txt", "@@", "-x", "+X", "*** End of File", "*** Delete File: b.txt",
    ))).toEqual([
      { type: "update", path: "a.txt", chunks: [{ oldLines: ["x"], newLines: ["X"], isEndOfFile: true }] },
      { type: "delete", path: "b.txt" },
    ]);
  });

  it("parses an update without chunks", () => {
    expect(parsePatch(patch("*** Update File: a.txt")))
      .toEqual([{ type: "update", path: "a.txt", chunks: [] }]);
  });
});

describe("patch matching", () => {
  it("replaces the matched lines", () => {
    expect(deriveNewContent("a.txt", [chunk(["b"], ["B"])], "a\nb\nc\n")).toBe("a\nB\nc\n");
  });

  it("matches after the @@ context line", () => {
    const source = "x\nfn one\nx\nfn two\nx\n";

    expect(deriveNewContent("a.txt", [chunk(["x"], ["y"], { changeContext: "fn two" })], source))
      .toBe("x\nfn one\nx\nfn two\ny\n");
  });

  it("searches each chunk forward from the previous match", () => {
    expect(deriveNewContent("a.txt", [chunk(["y"], ["Y"]), chunk(["x"], ["X"])], "x\ny\nx\n"))
      .toBe("x\nY\nX\n");
    expect(() => deriveNewContent("a.txt", [chunk(["b"], ["B"]), chunk(["a"], ["A"])], "a\nb\n"))
      .toThrow("Failed to find expected lines in a.txt:\na");
  });

  it.each([
    ["trailing whitespace", "value = 1   \n"],
    ["surrounding whitespace", "    value = 1\n"],
  ])("tolerates %s differences", (_case, source) => {
    expect(deriveNewContent("a.txt", [chunk(["value = 1"], ["value = 2"])], source)).toBe("value = 2\n");
  });

  it("tolerates Unicode punctuation differences", () => {
    const source = "say “hi” — it’s… done\n";

    expect(deriveNewContent("a.txt", [chunk(["say \"hi\" - it's... done"], ["changed"])], source))
      .toBe("changed\n");
  });

  it("prefers an exact match over an earlier fuzzy one", () => {
    expect(deriveNewContent("a.txt", [chunk(["x"], ["X"])], "x \nx\n")).toBe("x \nX\n");
  });

  it("matches the last occurrence for an end-of-file chunk", () => {
    expect(deriveNewContent("a.txt", [chunk(["x"], ["X"], { isEndOfFile: true })], "x\ny\nx\n"))
      .toBe("x\ny\nX\n");
  });

  it("appends a chunk without removed lines at the end, even with context", () => {
    expect(deriveNewContent("a.txt", [chunk([], ["c"], { changeContext: "a" })], "a\nb\n"))
      .toBe("a\nb\nc\n");
  });

  it("retries without a trailing empty line", () => {
    expect(deriveNewContent("a.txt", [chunk(["b", ""], ["B", ""])], "a\nb\n")).toBe("a\nB\n");
  });

  it("names the file and context when matching fails", () => {
    expect(() => deriveNewContent("a.txt", [chunk(["x"], ["y"], { changeContext: "nope" })], "x\n"))
      .toThrow("Failed to find context 'nope' in a.txt");
    expect(() => deriveNewContent("a.txt", [chunk(["nope"], ["y"])], "x\n"))
      .toThrow("Failed to find expected lines in a.txt:\nnope");
  });

  it.each([
    ["adds a final newline", "a\nb", [chunk(["b"], ["B"])], "a\nB\n"],
    ["keeps an untouched file", "a", [], "a\n"],
    ["empties a file whose lines are all removed", "a\n", [chunk(["a"], [])], ""],
  ])("%s", (_case, source, chunks, expected) => {
    expect(deriveNewContent("a.txt", chunks, source)).toBe(expected);
  });
});

describe("line endings", () => {
  it.each([
    ["one\r\ntwo\n", "\r\n"],
    ["one\ntwo\r\n", "\n"],
    ["one\n", "\n"],
    ["one", "\n"],
  ])("detects the first line ending of %j", (text, ending) => {
    expect(detectLineEnding(text)).toBe(ending);
  });

  it("normalizes CRLF and lone CR to LF and restores CRLF", () => {
    expect(normalizeToLF("a\r\nb\rc\n")).toBe("a\nb\nc\n");
    expect(restoreLineEndings("a\nb\n", "\r\n")).toBe("a\r\nb\r\n");
    expect(restoreLineEndings("a\nb\n", "\n")).toBe("a\nb\n");
  });
});

describe("byte order mark", () => {
  it("splits and restores a leading BOM", () => {
    expect(splitBom("﻿text")).toEqual({ bom: true, text: "text" });
    expect(splitBom("text")).toEqual({ bom: false, text: "text" });
    expect(joinBom("text", true)).toBe("﻿text");
    expect(joinBom("text", false)).toBe("text");
  });
});
