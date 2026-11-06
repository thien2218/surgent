import { describe, expect, it } from "vitest";
import { formatSymbols } from "../../../src/optimizer/mapper/helpers.js";
import { collectFixture, useGrammarCache } from "../../helpers/languages.js";

useGrammarCache();

describe("code_map layout", () => {
  it("nests members under their type and joins consecutive symbols of one kind", async () => {
    expect(formatSymbols(await collectFixture("Main.java"))).toEqual([
      "Main.java",
      " (imports) L3-L5",
      " [class] Main L7-L24",
      "  [method] Main L11; toString L13-L19",
      "  [class] Nested L21-L23",
      " [interface] Shape L26-L34",
      "  [method] label L31-L33",
      " [enum] Color L36-L49",
      "  [method] Color L42-L44; code L46-L48",
      " [record] Point L51-L59",
      "  [method] Point L52-L54; sum L56-L58",
      " [interface] Marker L61-L63",
    ]);
  });

  it("starts a new line for a symbol whose members follow it, including types defined outside it", async () => {
    expect(formatSymbols(await collectFixture("main.cpp")).slice(-4)).toEqual([
      " [struct] Shape L76-L78",
      " [struct] Tree L80-L84",
      "  [type] Key L81",
      "  [struct] Node L86-L88",
    ]);
  });

  it("keeps Type.member names when their types are filtered out", async () => {
    expect(formatSymbols(await collectFixture("main.go", ["method"]))).toEqual([
      "main.go",
      " [method] Server.Start L39-L43; List.Push L45",
    ]);
  });

  it("lists each file under its own path", async () => {
    const symbols = [...(await collectFixture("main.tsx")), ...(await collectFixture("main.h"))];
    expect(formatSymbols(symbols)).toEqual([
      "main.tsx",
      " (imports) L1",
      " [func] Counter L3-L6; default L8",
      "main.h",
      " (imports) L4",
      " [macro] LIMIT L6",
      " [type] buffer L8-L11",
    ]);
  });
});
