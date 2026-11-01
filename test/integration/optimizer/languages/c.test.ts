import { describe, expect, it } from "vitest";
import { inspectFixture, mapFixture, useGrammarCache } from "../../../helpers/languages.js";

useGrammarCache();

describe("C symbols", () => {
  it("groups includes and lists valued macros, typedefs, struct fields, and function definitions", async () => {
    expect(await mapFixture("main.c")).toEqual([
      "(imports) L1-L2",
      "[macro] BUFFER_SIZE L4",
      "[macro] MAX L5",
      "[type] uint L8",
      "[type] Point L10-L12",
      "[field] Point.x L11",
      "[field] Point.y L11",
      "[type] Size L14-L16",
      "[field] Size.width L15",
      "[struct] node L18-L27",
      "[field] node.value L19",
      "[field] node.next L20",
      "[field] node.visit L21",
      "[field] node.flags L22",
      "[union] number L29-L32",
      "[field] number.i L30",
      "[field] number.f L31",
      "[enum] color L34",
      "[decl] counter L36",
      "[decl] name L37",
      "[decl] on_exit L38",
      "[func] trace L44",
      "[func] helper L47-L50",
      "[func] name_of L52-L54",
    ]);
  });

  it("inspects a function definition rather than its forward declaration", async () => {
    expect(await inspectFixture("main.c", "helper", true)).toBe("int helper(int value)");
  });
});
