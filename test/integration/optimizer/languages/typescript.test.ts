import { describe, expect, it } from "vitest";
import { inspectFixture, mapFixture, useGrammarCache } from "../../../helpers/languages.js";

useGrammarCache();

describe("TypeScript symbols", () => {
  it("lists definitions, class members, class-valued properties, and default exports with line ranges", async () => {
    expect(await mapFixture("main.ts")).toEqual([
      "(imports) L1-L6",
      "(exports) L8-L9",
      "[decl] VERSION L11",
      "[decl] retries L12",
      "[decl] timeout L13",
      "[func] load L15-L19",
      "[func] ids L21",
      "[func] handler L23",
      "[func] format L25",
      "[func] overload L29-L31",
      "(imports)#1 L35",
      "[class] Store L37-L56",
      "[class] Store.Inner L41",
      "[method] Store.onChange L42",
      "[method] Store.constructor L44-L48",
      "[method] Store.size L50-L53",
      "[method] Store.size#1 L55",
      "[class] Base L58-L61",
      "[class] Anonymous L63-L65",
      "[method] Anonymous.run L64",
      "[interface] Shape L67-L70",
      "[type] Point L72",
      "[type] Result L73",
      "[enum] Color L75-L78",
      "[namespace] Geometry L80-L82",
      "[func] distance L81",
      "[interface] Window L89-L91",
      "[decl] routes L94-L97",
      "[method] routes.home L95",
      "[decl] default L107-L110",
      "[method] default.setup L109",
      "[func] overloaded L116-L118",
      '[namespace] "typed" L125-L127',
      "[interface] Options L126",
    ]);
  });

  it("parses TSX and names an unnamed default export default", async () => {
    expect(await mapFixture("main.tsx")).toEqual([
      "(imports) L1",
      "[func] Counter L3-L6",
      "[func] default L8",
    ]);
  });

  it("omits import and export groups when filtering by kind", async () => {
    expect(await mapFixture("main.ts", ["func"])).toEqual([
      "[func] load L15-L19",
      "[func] ids L21",
      "[func] handler L23",
      "[func] format L25",
      "[func] overload L29-L31",
      "[func] distance L81",
      "[func] overloaded L116-L118",
    ]);
  });

  it("starts a variable-bound function at its declaration and drops the arrow from its signature", async () => {
    expect(await inspectFixture("main.ts", "handler")).toBe("export const handler = async () => {}");
    expect(await inspectFixture("main.ts", "handler", true)).toBe("export const handler = async ()");
  });

  it("inspects a symbol in a file that starts with blank lines", async () => {
    expect(await inspectFixture("leading.ts", "greet")).toBe(
      ["function greet() {", "    return 1;", "  }"].join("\n"),
    );
    expect(await inspectFixture("leading.ts", "greet", true)).toBe("function greet()");
  });

  it("inspects consecutive imports and requires as one group", async () => {
    expect(await inspectFixture("main.ts", "(imports)")).toBe(
      [
        'import { readFile as read } from "node:fs/promises";',
        'import path from "node:path";',
        'import * as utils from "./utils";',
        'import "./polyfill";',
        'import fs = require("fs");',
        'const legacy = require("./legacy");',
      ].join("\n"),
    );
  });

  it("starts a decorated accessor's signature at its decorator", async () => {
    expect(await inspectFixture("main.ts", "Store.size", true)).toBe(
      ["@memoize()", "  get size()"].join("\n"),
    );
  });
});
