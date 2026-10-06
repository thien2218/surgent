import { describe, expect, it } from "vitest";
import { BashResultCompactor } from "../../../src/optimizer/compactor/bash.js";
import {
  extractGrepSummary,
  formatGrepResult,
} from "../../../src/optimizer/compactor/grep.js";

function compact(chunks: Buffer[]) {
  const output: Buffer[] = [];
  const compactor = new BashResultCompactor((data) => output.push(data));
  for (const chunk of chunks) compactor.append(chunk);
  compactor.finish();
  return Buffer.concat(output).toString("utf8");
}

describe("BashResultCompactor", () => {
  it("preserves UTF-8 and strips ANSI regardless of stream fragmentation", () => {
    const input = Buffer.from("\u001b[31mcafé 🦊\u001b[0m\r\nloading 1\rloading 2\r\nend");
    const expected = "café 🦊\nloading 2\nend";

    expect(compact([input])).toBe(expected);
    expect(compact(Array.from(input, (byte) => Buffer.from([byte])))).toBe(expected);
    for (let offset = 1; offset < input.length; offset++) {
      expect(compact([input.subarray(0, offset), input.subarray(offset)]), `split at byte ${offset}`).toBe(expected);
    }
  });

  it.each([
    ["", ""],
    ["\n", "\n"],
    ["last line", "last line"],
    ["last line\n", "last line\n"],
    ["old\rnew", "new"],
    ["progress\r", "progress"],
    ["progress\r\u001b[0m\r\n", "progress\n"],
  ])("flushes %j without losing content or inventing a newline", (input, expected) => {
    expect(compact([Buffer.from(input)])).toBe(expected);
  });

  it("drops consecutive exact repeats but keeps later occurrences", () => {
    expect(compact([Buffer.from("same\nsame\nsame\nother\nsame\n")])).toBe("same\nother\nsame\n");
  });

  it("keeps latest similar line and resets repeat notices between groups", () => {
    const input = "Downloading package 100\nDownloading package 101\nDownloading package 102\nOK\nOK\nUploading artifact 200\nUploading artifact 201";

    expect(compact([Buffer.from(input)])).toBe(
      "Downloading package 102 (similar line x2)\nOK\nUploading artifact 201 (similar line x1)",
    );
  });

  it("keeps short changes and dissimilar long lines", () => {
    const input = "step 1\nstep 2\nabcdefghij\n0123456789\nabcdefghij with much more content\n";

    expect(compact([Buffer.from(input)])).toBe(input);
  });

  it("streams settled lines before finish and flushes pending output only once", () => {
    const output: Buffer[] = [];
    const compactor = new BashResultCompactor((data) => output.push(data));
    compactor.append(Buffer.from("first\nsecond\npartial"));

    expect(Buffer.concat(output).toString()).toBe("first\n");
    compactor.finish();
    expect(Buffer.concat(output).toString()).toBe("first\nsecond\npartial");
    compactor.finish();
    expect(Buffer.concat(output).toString()).toBe("first\nsecond\npartial");
  });
});

describe("grep formatting", () => {
  it("merges overlapping context and promotes duplicates to matches without losing file ownership", () => {
    const output = formatGrepResult([
      "src/first.ts-9- before",
      "src/first.ts-10- hit",
      "src/first.ts:10: hit",
      "src/first.ts-10- hit",
      "src/first.ts:11: next hit",
      "src/second.ts:10: other hit",
      "src/first.ts:10: hit",
      "src/first.ts:20: later hit",
    ].join("\n"));

    expect(output).toEqual([
      "src/first.ts", "9- before", "10: hit", "11: next hit",
      "src/second.ts", "10: other hit", "src/first.ts", "20: later hit",
    ]);
  });

  it("keeps blank match text, colon-bearing paths, and trailing limit notices", () => {
    expect(formatGrepResult("src/a:b.ts:4: \n\n[100 matches limit reached. Use limit=200 for more]")).toEqual([
      "src/a:b.ts", "4: ", "", "[100 matches limit reached. Use limit=200 for more]",
    ]);
    expect(formatGrepResult("No matches found")).toEqual(["No matches found"]);
  });
});

describe("grep summaries", () => {
  it("retains unique match locations and notices but omits source and context text", () => {
    const content = [
      "src/first.ts", "2- context only", "3: private source", "3: private source", "8: other source",
      "src/second.ts", "1: second source", "src/first.ts", "12: later source",
      "", "[100 matches limit reached. Use limit=200 for more]",
    ].join("\n");

    expect(extractGrepSummary(content)).toBe(
      "src/first.ts: lines_matched=[3, 8, 12]\nsrc/second.ts: lines_matched=[1]\n\n[100 matches limit reached. Use limit=200 for more]",
    );
  });

  it.each(["No matches found", "", "src/file.ts\n2- context only", "4: orphan match", "[Search unavailable]"])(
    "does not invent a summary for %j", (content) => {
      expect(extractGrepSummary(content)).toBeNull();
    },
  );
});
