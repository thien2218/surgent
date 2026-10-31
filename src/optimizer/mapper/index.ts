import { defineTool, truncateHead, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveTargetPaths } from "./files.js";
import {
  collectSymbols,
  formatSymbolName,
  readLanguages,
  SHARED_KINDS,
  SYMBOL_KINDS,
  type LanguageSymbol,
} from "../grammar/index.js";
import { renderCallText } from "../../utils.js";

interface MapperResult {
  symbols: LanguageSymbol[];
  failed: string[];
}

async function loadKindsPrompt(cwd: string) {
  const languages = (await readLanguages(cwd)) ?? [];
  const list = languages.map(({ name, profile }) => `- ${name}: ${profile.extraKinds.join(", ")}`);
  return [
    "Values for code_map `kinds`, by language. Shared kinds apply to all languages.",
    `- shared: ${SHARED_KINDS.join(", ")}`,
    ...list,
  ].join("\n");
}

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
      const name = formatSymbolName("<imports>", importsGroupIndex);
      return [{ ...symbol, name, range: undefined }];
    }

    exportsGroupIndex += 1;
    const name = formatSymbolName("<exports>", exportsGroupIndex);
    return [{ ...symbol, name, range: undefined }];
  });
}

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event, ctx) => {
    if (pi.getActiveTools().includes("code_map")) {
      event.systemPromptOptions.sections.symbol_kinds = await loadKindsPrompt(ctx.cwd);
    } else {
      delete event.systemPromptOptions.sections.symbol_kinds;
    }
  });

  pi.registerTool(
    defineTool({
      name: "code_map",
      label: "Code map",
      description:
        "List symbols and code blocks with line ranges, to pick inspect targets or read offset/limit.",
      parameters: Type.Object({
        paths: Type.Array(Type.String({ minLength: 1 }), {
          description: "Files or directories to scan, no globs. Keep narrow",
          minItems: 1,
          uniqueItems: true,
        }),
        glob: Type.Optional(
          Type.String({ description: "Filter files found in directories, same as grep glob" }),
        ),
        kinds: Type.Optional(
          Type.Array(Type.String(), { description: "Filter symbols by kinds (default: all)" }),
        ),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        let outputPath = "";
        const outputLines: string[] = [];
        const kinds = params.kinds ? new Set(params.kinds) : undefined;
        const unknownKinds = params.kinds?.filter((kind) => !SYMBOL_KINDS.has(kind)) ?? [];
        const { files, denied, failed } = await resolveTargetPaths(
          pi,
          ctx,
          params.paths,
          params.glob,
          signal,
        );
        const result: MapperResult = { symbols: [], failed };

        for (const file of files) {
          signal?.throwIfAborted();
          try {
            const symbols = collapseGroupedSymbols(await collectSymbols(ctx.cwd, file, kinds));
            result.symbols.push(...symbols);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            result.failed.push(`${file}: ${message}`);
          }
        }

        for (const symbol of result.symbols) {
          if (symbol.path !== outputPath) {
            outputPath = symbol.path;
            outputLines.push(symbol.path);
          }

          const modifier = symbol.public && symbol.kind !== "public" ? "public " : "";
          let line = ` [${modifier}${symbol.kind}] ${symbol.name}`;
          if (symbol.range) {
            line += ` L${symbol.range[0]}-L${symbol.range[1]}`;
          }
          outputLines.push(line);
        }

        if (result.failed.length > 0) {
          outputLines.push(...result.failed);
        }
        if (denied) {
          outputLines.push("[Code map results exclude files blocked by permission policy]");
        }
        if (unknownKinds.length > 0) {
          outputLines.push(`[Unknown kinds: ${unknownKinds.join(", ")}]`);
        }
        if (outputLines.length === 0) {
          outputLines.push("(no symbols found)");
        }

        const truncation = truncateHead(outputLines.join("\n"));
        const output = truncation.truncated
          ? `${truncation.content}\n\n[Output truncated at 2000 lines or 50KB. Narrow paths, glob, or kinds.]`
          : truncation.content;
        return { details: null, content: [{ type: "text", text: output }] };
      },
      renderCall(args, theme, { isPartial }) {
        const paths = Array.isArray(args.paths) ? args.paths.join(", ") : "";
        const glob = typeof args.glob === "string" ? args.glob : "";
        const kinds = Array.isArray(args.kinds) ? args.kinds.join(", ") : "default";

        return renderCallText(
          `${theme.fg("toolTitle", "code_map")} ${theme.fg("accent", paths)}${glob ? ` ${theme.fg("dim", `/${glob}/`)}` : ""} ${theme.fg("dim", `(${kinds})`)}`,
          isPartial,
        );
      },
    }),
  );
}
