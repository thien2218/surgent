import { describe, expect, it } from "vitest";
import { inspectFixture, mapFixture, useGrammarCache } from "../../../helpers/languages.js";

useGrammarCache();

describe("Python symbols", () => {
  it("groups top-level imports and lists module bindings and class members from their decorators", async () => {
    expect(await mapFixture("main.py")).toEqual([
      "(imports) L1-L5",
      "(exports) L15",
      "[decl] VERSION L17",
      "[decl] low L18",
      "[decl] high L18",
      "[func] square L19",
      "[type] Vector L21",
      "[func] load L24-L29",
      "[func] fetch L32-L34",
      "[class] Point L37-L52",
      "[field] Point.x L39",
      "[field] Point.y L40",
      "[field] Point.tags L41",
      "[method] Point.scale L42",
      "[method] Point.__init__ L44-L45",
      "[method] Point.origin L47-L49",
    ]);
  });

  it("strips method bodies from a decorated class signature", async () => {
    expect(await inspectFixture("main.py", "Point", true)).toBe(
      [
        "@dataclass",
        "class Point:",
        "    x: int",
        "    y: int = 0",
        "    tags: list[str] = field(default_factory=list)",
        "    scale = lambda self, factor: factor",
        "",
        "    def __init__(self):",
        "",
        "    @staticmethod",
        "    def origin():",
        "",
        "    class Meta:",
        '        ordering = ["x"]',
      ].join("\n"),
    );
  });

  it("inspects top-level imports across blank lines without the ones nested in try and if", async () => {
    expect(await inspectFixture("main.py", "(imports)")).toBe(
      [
        "from __future__ import annotations",
        "",
        "import os.path as osp",
        "from dataclasses import dataclass, field",
        "from typing import TYPE_CHECKING",
      ].join("\n"),
    );
    expect(await inspectFixture("main.py", "(imports)#1")).toBeUndefined();
  });

  it("inspects each name of a tuple assignment as the whole assignment", async () => {
    expect(await inspectFixture("main.py", "high")).toBe("low, high = 0, 10");
  });
});
