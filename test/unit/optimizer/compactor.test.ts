import { describe, expect, it } from "vitest";
import { extractGrepSummary } from "../../../src/optimizer/compactor/grep.js";

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
