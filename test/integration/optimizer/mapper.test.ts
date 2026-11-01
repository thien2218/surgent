import { describe, expect, it } from "vitest";
import { formatSymbols } from "../../../src/optimizer/mapper/helpers.js";
import { collectFixture, useGrammarCache } from "../../helpers/languages.js";

useGrammarCache();

describe("code_map layout", () => {
  it("nests members under their type and joins consecutive symbols of one kind", async () => {
    expect(formatSymbols(await collectFixture("main.go"))).toEqual([
      "main.go",
      " (imports) L3-L7",
      " [decl] Version L10; maxRetries L11; low L14; high L14",
      " [func] handle L16",
      " [type] ID L18; Celsius L20",
      " [struct] Server L22-L28",
      "  [field] Name L23; Host L23; port L24; Config L25; Handler L26; inner L27",
      " [struct] List L30-L32",
      "  [field] items L31",
      " [interface] Store L34-L37",
      "  [method] Get L36",
      " [method] Server.Start L39-L43; List.Push L45",
      " [func] NewServer L47-L49; main L51-L54",
    ]);
  });

  it("starts a new line for a symbol whose members follow it", async () => {
    expect(formatSymbols(await collectFixture("main.c")).slice(0, 7)).toEqual([
      "main.c",
      " (imports) L1-L2",
      " [macro] BUFFER_SIZE L4; MAX L5",
      " [type] uint L8",
      " [type] Point L10-L12",
      "  [field] x L11; y L11",
      " [type] Size L14-L16",
    ]);
  });

  it("keeps Type.member names when their types are filtered out", async () => {
    expect(formatSymbols(await collectFixture("main.go", ["method"]))).toEqual([
      "main.go",
      " [method] Store.Get L36; Server.Start L39-L43; List.Push L45",
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
      "  [field] length L9; data L10",
    ]);
  });
});
