import { describe, expect, it } from "vitest";
import { inspectFixture, mapFixture, useGrammarCache } from "../../../helpers/languages.js";

useGrammarCache();

describe("Rust symbols", () => {
  it("lists items, struct and union fields, associated constants, and impl methods named by type", async () => {
    expect(await mapFixture("main.rs")).toEqual([
      "(imports) L1-L4",
      "[decl] VERSION L6",
      "[decl] COUNTER L7",
      "[struct] Point L9-L13",
      "[field] Point.x L11",
      "[field] Point.y L12",
      "[struct] Pair L15",
      "[union] Bits L17-L20",
      "[field] Bits.int L18",
      "[field] Bits.float L19",
      "[enum] Shape L22-L25",
      "[type] Map L27",
      "[field] Point.ORIGIN L30",
      "[method] Point.new L32-L34",
      "[method] Wrapper.get L38-L40",
      "[trait] Draw L43-L51",
      "[field] Draw.ID L44",
      "[method] Draw.draw L46",
      "[method] Draw.redraw L48-L50",
      "[method] Point.fmt L54-L56",
      "[module] geometry L59-L63",
      "[func] area L60-L62",
      "[macro] square L69-L73",
      "[func] main L75-L78",
    ]);
  });

  it("keeps required trait methods and strips default method bodies", async () => {
    expect(await inspectFixture("main.rs", "Draw", true)).toBe(
      [
        "pub trait Draw {",
        "    const ID: u32;",
        "",
        "    fn draw(&self);",
        "",
        "    fn redraw(&self)",
        "}",
      ].join("\n"),
    );
  });
});
