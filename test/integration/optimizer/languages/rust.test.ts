import { describe, expect, it } from "vitest";
import { inspectFixture, mapFixture, useGrammarCache } from "../../../helpers/languages.js";

useGrammarCache();

describe("Rust symbols", () => {
  it("lists items, associated types, and impl methods named by type without trait signatures", async () => {
    expect(await mapFixture("main.rs")).toEqual([
      "(imports) L1-L4",
      "[decl] VERSION L6",
      "[decl] COUNTER L7",
      "[struct] Point L9-L13",
      "[struct] Pair L15",
      "[union] Bits L17-L20",
      "[enum] Shape L22-L25",
      "[type] Map L27",
      "[method] Point.new L32-L34",
      "[method] Wrapper.get L38-L40",
      "[trait] Draw L43-L51",
      "[method] Draw.redraw L48-L50",
      "[method] Point.fmt L54-L56",
      "[module] geometry L59-L63",
      "[func] area L60-L62",
      "[macro] square L69-L73",
      "[func] main L75-L78",
      "[type] Pair.Item L81",
      "[method] Pair.next L83-L85",
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
