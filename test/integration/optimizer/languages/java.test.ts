import { describe, expect, it } from "vitest";
import { inspectFixture, mapFixture, useGrammarCache } from "../../../helpers/languages.js";

useGrammarCache();

describe("Java symbols", () => {
  it("lists types, fields, record components, and members while skipping nested and anonymous classes", async () => {
    expect(await mapFixture("Main.java")).toEqual([
      "(imports) L3-L5",
      "[class] Main L7-L24",
      "[field] Main.MAX L8",
      "[field] Main.low L9",
      "[field] Main.high L9",
      "[method] Main.Main L11",
      "[method] Main.toString L13-L19",
      "[interface] Shape L26-L34",
      "[field] Shape.SIDES L27",
      "[method] Shape.area L29",
      "[method] Shape.label L31-L33",
      "[enum] Color L36-L49",
      "[field] Color.code L40",
      "[method] Color.Color L42-L44",
      "[method] Color.code#1 L46-L48",
      "[record] Point L51-L59",
      "[field] Point.x L51",
      "[field] Point.y L51",
      "[method] Point.Point L52-L54",
      "[method] Point.sum L56-L58",
      "[interface] Marker L61-L63",
      "[method] Marker.value L62",
    ]);
  });

  it("groups module requires as imports and exports as exports", async () => {
    expect(await mapFixture("module-info.java")).toEqual(["(imports) L2", "(exports) L3"]);
  });

  it("inspects each name of a multi-name field as the whole declaration", async () => {
    expect(await inspectFixture("Main.java", "Main.high")).toBe("private int low, high;");
  });

  it("strips method bodies of nested classes from a class signature", async () => {
    expect(await inspectFixture("Main.java", "Main", true)).toBe(
      [
        "public class Main {",
        "  public static final int MAX = 10;",
        "  private int low, high;",
        "",
        "  public Main()",
        "",
        "  @Override",
        "  public String toString()",
        "",
        "  static class Nested {",
        "    void hidden()",
        "  }",
        "}",
      ].join("\n"),
    );
  });

  it("numbers a method sharing a field's name the same when filtering by method", async () => {
    expect(await mapFixture("Main.java", ["method"])).toEqual([
      "[method] Main.Main L11",
      "[method] Main.toString L13-L19",
      "[method] Shape.area L29",
      "[method] Shape.label L31-L33",
      "[method] Color.Color L42-L44",
      "[method] Color.code#1 L46-L48",
      "[method] Point.Point L52-L54",
      "[method] Point.sum L56-L58",
      "[method] Marker.value L62",
    ]);
  });

  it("strips constructor and method bodies from an enum signature", async () => {
    expect(await inspectFixture("Main.java", "Color", true)).toBe(
      [
        "enum Color {",
        "  RED(1),",
        "  GREEN(2);",
        "",
        "  private final int code;",
        "",
        "  Color(int code)",
        "",
        "  int code()",
        "}",
      ].join("\n"),
    );
  });
});
