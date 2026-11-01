import { describe, expect, it } from "vitest";
import { inspectFixture, mapFixture, useGrammarCache } from "../../../helpers/languages.js";

useGrammarCache();

describe("Zig symbols", () => {
  it("groups imports and lists container fields and constants, methods of returned structs, and tests", async () => {
    expect(await mapFixture("main.zig")).toEqual([
      "(imports) L1-L6",
      "[decl] max_items L8",
      "[decl] counter L9",
      "[struct] Point L11-L22",
      "[field] Point.x L12",
      "[field] Point.y L13",
      "[field] Point.Self L15",
      "[method] Point.init L18-L21",
      "[enum] Color L24-L31",
      "[method] Color.isWarm L28-L30",
      "[union] Number L33-L36",
      "[field] Number.int L34",
      "[field] Number.float L35",
      "[type] Handle L38",
      "[type] Failure L39",
      "[func] List L41-L49",
      "[field] List.items L43",
      "[method] List.len L45-L47",
      "[func] main L51-L54",
      '[func] test "point starts at origin" L56',
    ]);
  });

  it("strips method bodies from a struct signature", async () => {
    expect(await inspectFixture("main.zig", "Point", true)).toBe(
      [
        "pub const Point = struct {",
        "    x: i32,",
        "    y: i32 = 0,",
        "",
        "    const Self = @This();",
        "    const Inner = struct { depth: u8 };",
        "",
        "    pub fn init() Point",
        "};",
      ].join("\n"),
    );
  });
});
