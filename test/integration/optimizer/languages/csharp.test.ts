import { describe, expect, it } from "vitest";
import { inspectFixture, mapFixture, useGrammarCache } from "../../../helpers/languages.js";

useGrammarCache();

describe("C# symbols", () => {
  it("groups usings and lists top-level functions, members, auto-properties as fields, and record parameters", async () => {
    expect(await mapFixture("main.cs")).toEqual([
      "(imports) L1-L3",
      "[func] Twice L7",
      "[class] Widget L11-L39",
      "[field] Widget.Max L13",
      "[field] Widget.width L14",
      "[field] Widget.height L14",
      "[field] Widget.Name L15",
      "[method] Widget.Area L16",
      "[method] Widget.Perimeter L17",
      "[field] Widget.Changed L18",
      "[method] Widget.Widget L20",
      "[method] Widget.~Widget L22",
      "[method] Widget.operator+ L24",
      "[method] Widget.operator int L26",
      "[method] Widget.this[] L28",
      "[method] Widget.Draw L30-L33",
      "[struct] Point L41-L44",
      "[field] Point.X L43",
      "[interface] IShape L46-L50",
      "[field] IShape.Sides L48",
      "[method] IShape.Area L49",
      "[record] Person L52",
      "[field] Person.Name L52",
      "[field] Person.Age L52",
      "[enum] Color L54",
      "[type] Handler L56",
    ]);
  });

  it("strips the body from a method signature", async () => {
    expect(await inspectFixture("main.cs", "Widget.Draw", true)).toBe("public void Draw()");
  });
});
