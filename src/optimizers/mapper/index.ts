import { defineTool, truncateHead } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveTargetPaths } from "./files.js";
import { collectSymbols, SYMBOL_KINDS } from "../languages/index.js";
import type { LanguageSymbol } from "../languages/index.js";
import type { MapperResult } from "./types.js";
import { renderCallText } from "../../utils.js";

function collapseGroupedSymbols(symbols: LanguageSymbol[]) {
  let groupedSymbolKind: "deps" | "public" | undefined;
  let importsGroupIndex = 0;
  let exportsGroupIndex = 0;

  return symbols.flatMap((symbol) => {
    if (symbol.kind !== "deps" && symbol.kind !== "public") {
      groupedSymbolKind = undefined;
      return [symbol];
    }
    if (symbol.kind === groupedSymbolKind) return [];

    groupedSymbolKind = symbol.kind;
    if (symbol.kind === "deps") {
      importsGroupIndex += 1;
      return [{ ...symbol, name: `imports~${importsGroupIndex}`, range: undefined }];
    }

    exportsGroupIndex += 1;
    return [{ ...symbol, name: `exports~${exportsGroupIndex}`, range: undefined }];
  });
}

const codeMap = defineTool({
  name: "code_map",
  label: "Code map",
  description:
    "Fast symbol and code blocks offset/limit indexing. Best for: narrowing targets to inspect/read or code discovery.",
  parameters: Type.Object({
    targets: Type.Array(Type.String(), {
      description: "Paths or globs to scan (relative to cwd). Keep scope narrow.",
    }),
    kinds: Type.Optional(
      Type.Array(Type.Union(SYMBOL_KINDS.map((kind) => Type.Literal(kind))), {
        description: "Abstraction kinds to include. Omit to include all supported.",
      }),
    ),
  }),
  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    const kinds = new Set(params.kinds ?? SYMBOL_KINDS);
    const result: MapperResult = { symbols: [], failed: [] };
    let paths: string[] = [];
    try {
      paths = await resolveTargetPaths(ctx.cwd, params.targets, signal);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        details: `code_map target scan failed: ${message}`,
        content: [{ type: "text", text: `code_map target scan failed: ${message}` }],
      };
    }

    if (paths.length === 0) {
      return {
        isError: false,
        details: "(no symbols found) targets matched no supported files or symbols",
        content: [
          {
            type: "text",
            text: "(no symbols found) targets matched no supported files or symbols",
          },
        ],
      };
    }

    for (const path of paths) {
      if (signal?.aborted) {
        return {
          isError: true,
          details: "code_map aborted",
          content: [{ type: "text", text: "code_map aborted" }],
        };
      }

      try {
        const symbols = collapseGroupedSymbols(await collectSymbols(ctx.cwd, path, kinds));
        result.symbols.push(...symbols);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.failed.push(`${path}: ${message}`);
      }
    }

    const outputLines: string[] = [];
    let outputPath = "";

    for (const symbol of result.symbols) {
      if (symbol.path !== outputPath) {
        outputPath = symbol.path;
        outputLines.push(symbol.path);
      }

      let line = `  [${symbol.public ? "public " : ""}${symbol.kind}] ${symbol.name}`;
      if (symbol.range) {
        line += ` L${symbol.range[0]}-L${symbol.range[1]}`;
      }
      outputLines.push(line);
    }

    if (result.failed.length > 0) {
      outputLines.push(...result.failed.map((failure) => `failed ${failure}`));
    }
    if (outputLines.length === 0) {
      outputLines.push("(no symbols found) targets matched no supported files or symbols");
    }

    const truncation = truncateHead(outputLines.join("\n"));
    const output = truncation.truncated
      ? `${truncation.content}\n\n[Output truncated at 2000 lines or 50KB. Narrow targets or kinds.]`
      : truncation.content;
    return { isError: false, details: output, content: [{ type: "text", text: output }] };
  },
  renderCall(args, theme, { isPartial }) {
    const targets = Array.isArray(args.targets) ? args.targets.join(", ") : "";
    const kinds = Array.isArray(args.kinds) ? args.kinds.join(", ") : "default";

    return renderCallText(
      `${theme.fg("toolTitle", "code_map")} ${theme.underline(theme.fg("accent", targets))} ${theme.fg("dim", `[${kinds}]`)}`,
      isPartial,
    );
  },
});

export default codeMap;
