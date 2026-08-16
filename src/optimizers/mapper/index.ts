import { defineTool, keyHint } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { resolveTargetPaths } from "./files.js";
import { collectSymbols, SYMBOL_KINDS } from "../languages/index.js";
import type { LanguageSymbol } from "../languages/index.js";
import type { MapperResult } from "./types.js";

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

    const output = outputLines.join("\n");
    return { isError: false, details: output, content: [{ type: "text", text: output }] };
  },
  renderCall(args, theme) {
    const targets = Array.isArray(args.targets) ? args.targets.join(", ") : "";
    const kinds = Array.isArray(args.kinds) ? args.kinds.join(", ") : "default";

    return new Text(
      `${theme.fg("toolTitle", "code_map")} targets=[${targets}] kinds=[${kinds}]`,
      0,
      0,
    );
  },
  renderResult(result, { isPartial, expanded }, theme) {
    if (isPartial) {
      return new Text(theme.fg("warning", "Mapping..."), 0, 0);
    }

    const text = result.details as string;
    const lines = text.split("\n");
    const maxLines = expanded ? lines.length : 10;

    if (lines.length === 0) {
      return new Text(theme.fg("dim", "No symbols found"), 0, 0);
    }

    const visible = lines.slice(0, maxLines);
    if (lines.length > maxLines) {
      visible.push(
        `... (${lines.length - maxLines} more lines, ${keyHint("app.tools.expand", "to expand")})`,
      );
    }

    return new Text(visible.join("\n"), 0, 0);
  },
});

export default codeMap;
