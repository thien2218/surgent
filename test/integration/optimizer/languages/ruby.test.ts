import { describe, expect, it } from "vitest";
import { inspectFixture, mapFixture, useGrammarCache } from "../../../helpers/languages.js";

useGrammarCache();

describe("Ruby symbols", () => {
  it("groups requires and lists module bindings, class members, and struct factories", async () => {
    expect(await mapFixture("main.rb")).toEqual([
      "(imports) L1-L4",
      "[decl] VERSION L8",
      "[decl] settings L9",
      "[decl] $debug L10",
      "[func] square L11",
      "[func] greet L13-L15",
      "[module] Config L17-L42",
      "[decl] TIMEOUT L18",
      "[method] Config.load L20",
      "[class] Store L22-L41",
      "[field] Store.name L23",
      "[field] Store.size L23",
      "[field] Store.limit L24",
      "[field] Store.MAX L25",
      "[field] Store.@@count L26",
      "[method] Store.HANDLER L27",
      "[method] Store.initialize L30-L32",
      "[method] Store.build L34",
      "[method] Store.default L37",
      "[class] Point L44-L48",
      "[method] Point.to_s L45-L47",
    ]);
  });

  it("strips the body from a method signature", async () => {
    expect(await inspectFixture("main.rb", "Store.initialize", true)).toBe(
      ["def initialize(name)", "    end"].join("\n"),
    );
  });

  it("strips the body from a lambda bound to a variable or constant", async () => {
    expect(await inspectFixture("main.rb", "square", true)).toBe("square = ->(value)");
    expect(await inspectFixture("main.rb", "Store.HANDLER", true)).toBe(
      "HANDLER = lambda { |item| }",
    );
  });
});
