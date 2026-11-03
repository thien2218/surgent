import { describe, expect, it } from "vitest";
import { inspectFixture, mapFixture, useGrammarCache } from "../../../helpers/languages.js";

useGrammarCache();

describe("C++ symbols", () => {
  it("lists namespaces, nested types, methods with bodies, templates, and lambdas without prototypes", async () => {
    expect(await mapFixture("main.cpp")).toEqual([
      "(imports) L1-L6",
      "[macro] LOG L8",
      "[type] Id L10",
      "[type] Size L11",
      "[namespace] app L13-L43",
      "[class] Widget L15-L33",
      "[method] Widget.area L25",
      "[class] Widget.Part L27-L29",
      "[method] Widget.Widget L35",
      "[method] Widget.~Widget L37",
      "[method] Widget.draw L39",
      "[struct] Box L45-L51",
      "[method] Box.get L48",
      "[method] Box.put L53-L55",
      "[func] largest L57-L60",
      "[union] Number L62-L65",
      "[enum] Color L67",
      "[func] add L69",
      "[func] main L71-L74",
      "[struct] Shape L76-L78",
      "[struct] Tree L80-L84",
      "[type] Tree.Key L81",
      "[struct] Tree.Node L86-L88",
    ]);
  });

  it("lists includes inside an include guard without listing the guard or prototypes", async () => {
    expect(await mapFixture("main.h")).toEqual([
      "(imports) L4",
      "[macro] LIMIT L6",
      "[type] buffer L8-L11",
    ]);
  });

  it("inspects a nested type defined outside its container by its container-qualified name", async () => {
    expect(await inspectFixture("main.cpp", "Tree.Node")).toBe(
      ["struct Tree::Node {", "  Key key;", "}"].join("\n"),
    );
  });

  it("strips inline method bodies from a class signature", async () => {
    expect(await inspectFixture("main.cpp", "Widget", true)).toBe(
      [
        "class Widget {",
        "public:",
        "  static constexpr int MAX = 10;",
        "  int width = 0;",
        "  std::function<void()> callback;",
        "",
        "  Widget();",
        "  ~Widget();",
        "  void draw();",
        "  bool operator==(const Widget &other) const;",
        "  int area() const",
        "",
        "  class Part {",
        "    void attach();",
        "  };",
        "",
        "private:",
        "  string label;",
        "}",
      ].join("\n"),
    );
  });

  it("strips the body from a lambda bound to a variable", async () => {
    expect(await inspectFixture("main.cpp", "add", true)).toBe("auto add = [](int left, int right);");
  });

  it("starts a template at its outermost template line", async () => {
    expect(await inspectFixture("main.cpp", "Box.put")).toBe(
      ["template <typename T>", "template <typename U>", "void Box<T>::put(U item) {}"].join("\n"),
    );
  });
});
