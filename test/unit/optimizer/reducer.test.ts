import { describe, expect, it } from "vitest";
import { BashResultReducer } from "../../../src/optimizer/reducer/bash.js";
import { formatGrepResult } from "../../../src/optimizer/reducer/grep.js";

function reduce(chunks: Buffer[]) {
  const output: Buffer[] = [];
  const reducer = new BashResultReducer((data) => output.push(data));
  for (const chunk of chunks) reducer.append(chunk);
  reducer.finish();
  return Buffer.concat(output).toString("utf8");
}

describe("BashResultReducer", () => {
  it("preserves UTF-8 and strips ANSI regardless of stream fragmentation", () => {
    const input = Buffer.from("\u001b[31mcafé 🦊\u001b[0m\r\nloading 1\rloading 2\r\nend");
    const expected = "café 🦊\nloading 2\nend";

    expect(reduce([input])).toBe(expected);
    expect(reduce(Array.from(input, (byte) => Buffer.from([byte])))).toBe(expected);
    for (let offset = 1; offset < input.length; offset++) {
      expect(reduce([input.subarray(0, offset), input.subarray(offset)]), `split at byte ${offset}`).toBe(expected);
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
    expect(reduce([Buffer.from(input)])).toBe(expected);
  });

  it("drops consecutive exact repeats but keeps later occurrences", () => {
    expect(reduce([Buffer.from("same\nsame\nsame\nother\nsame\n")])).toBe("same\nother\nsame\n");
  });

  it("keeps latest similar line and resets repeat notices between groups", () => {
    const input = "Downloading package 100\nDownloading package 101\nDownloading package 102\nOK\nOK\nUploading artifact 200\nUploading artifact 201";

    expect(reduce([Buffer.from(input)])).toBe(
      "Downloading package 102 (similar line x2)\nOK\nUploading artifact 201 (similar line x1)",
    );
  });

  it("keeps short changes and dissimilar long lines", () => {
    const input = "step 1\nstep 2\nabcdefghij\n0123456789\nabcdefghij with much more content\n";

    expect(reduce([Buffer.from(input)])).toBe(input);
  });

  it("streams settled lines before finish and flushes pending output only once", () => {
    const output: Buffer[] = [];
    const reducer = new BashResultReducer((data) => output.push(data));
    reducer.append(Buffer.from("first\nsecond\npartial"));

    expect(Buffer.concat(output).toString()).toBe("first\n");
    reducer.finish();
    expect(Buffer.concat(output).toString()).toBe("first\nsecond\npartial");
    reducer.finish();
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
