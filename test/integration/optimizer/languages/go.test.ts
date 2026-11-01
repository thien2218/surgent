import { describe, expect, it } from "vitest";
import { inspectFixture, mapFixture, useGrammarCache } from "../../../helpers/languages.js";

useGrammarCache();

describe("Go symbols", () => {
  it("groups imports and lists struct fields and methods named by receiver type", async () => {
    expect(await mapFixture("main.go")).toEqual([
      "(imports) L3-L7",
      "[decl] Version L10",
      "[decl] maxRetries L11",
      "[decl] low L14",
      "[decl] high L14",
      "[func] handle L16",
      "[type] ID L18",
      "[type] Celsius L20",
      "[struct] Server L22-L28",
      "[field] Server.Name L23",
      "[field] Server.Host L23",
      "[field] Server.port L24",
      "[field] Server.Config L25",
      "[field] Server.Handler L26",
      "[field] Server.inner L27",
      "[struct] List L30-L32",
      "[field] List.items L31",
      "[interface] Store L34-L37",
      "[method] Store.Get L36",
      "[method] Server.Start L39-L43",
      "[method] List.Push L45",
      "[func] NewServer L47-L49",
      "[func] main L51-L54",
    ]);
  });

  it("strips the body from a method signature", async () => {
    expect(await inspectFixture("main.go", "Server.Start", true)).toBe(
      "func (s *Server) Start() error",
    );
  });

  it("strips the body from a function bound to a variable", async () => {
    expect(await inspectFixture("main.go", "handle", true)).toBe("handle = func()");
  });
});
