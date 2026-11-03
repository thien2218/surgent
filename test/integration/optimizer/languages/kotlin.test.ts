import { describe, expect, it } from "vitest";
import { inspectFixture, mapFixture, useGrammarCache } from "../../../helpers/languages.js";

useGrammarCache();

describe("Kotlin symbols", () => {
  it("groups imports and lists extension functions, nested classes, and class and companion members with bodies", async () => {
    expect(await mapFixture("main.kt")).toEqual([
      "(imports) L3-L4",
      "[decl] VERSION L6",
      "[decl] counter L7",
      "[func] square L8",
      "[type] Handler L10",
      "[func] main L12-L15",
      "[func] helper L17",
      "[method] String.shout L19",
      "[method] String.initial L21-L22",
      "[class] Point L24-L39",
      "[method] Point.onMove L26",
      "[method] Point.label L27-L28",
      "[method] Point.distance L30",
      "[method] Point.origin L35",
      "[class] Point.Builder L38",
      "[interface] Shape L41-L45",
      "[interface] Action L47-L49",
      "[enum] Color L51-L56",
      "[method] Color.describe L55",
      "[object] Registry L58-L62",
      "[method] Registry.register L61",
    ]);
  });

  it("strips function bodies from an object signature", async () => {
    expect(await inspectFixture("main.kt", "Registry", true)).toBe(
      [
        "object Registry {",
        "    val items = mutableListOf<String>()",
        "",
        "    fun register(item: String)",
        "}",
      ].join("\n"),
    );
  });
});
