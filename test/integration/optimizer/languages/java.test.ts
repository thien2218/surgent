import { describe, expect, it } from "vitest";
import { inspectFixture, mapFixture, useGrammarCache } from "../../../helpers/languages.js";

useGrammarCache();

describe("Java symbols", () => {
  it("lists types, nested types, and members with bodies while skipping fields, signatures, and anonymous classes", async () => {
    expect(await mapFixture("Main.java")).toEqual([
      "(imports) L3-L5",
      "[class] Main L7-L24",
      "[method] Main.Main L11",
      "[method] Main.toString L13-L19",
      "[class] Main.Nested L21-L23",
      "[interface] Shape L26-L34",
      "[method] Shape.label L31-L33",
      "[enum] Color L36-L49",
      "[method] Color.Color L42-L44",
      "[method] Color.code L46-L48",
      "[record] Point L51-L59",
      "[method] Point.Point L52-L54",
      "[method] Point.sum L56-L58",
      "[interface] Marker L61-L63",
    ]);
  });

  it("groups module requires as imports and exports as exports", async () => {
    expect(await mapFixture("module-info.java")).toEqual(["(imports) L2", "(exports) L3"]);
  });

  it("inspects a nested class by its container-qualified name", async () => {
    expect(await inspectFixture("Main.java", "Main.Nested")).toBe(
      ["static class Nested {", "    void hidden() {}", "  }"].join("\n"),
    );
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
