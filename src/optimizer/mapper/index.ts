import { defineTool, truncateHead, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveTargetPaths } from "./files.js";
import { formatSymbols, loadKindsPrompt } from "./helpers.js";
import { collectSymbols, SYMBOL_KINDS, type LanguageSymbol } from "../grammar/index.js";
import { renderCallText } from "../../utils.js";

const DESCRIPTION = [
  "List symbols with line ranges, in source order under each file path:",
  "",
  "- `[<kind>]` applies to every `;`-separated symbol on its line.",
  "- Indented symbols are members of the line above. Inspect them as `Type.member`.",
  "",
  "Example:",
  "",
  "```",
  "src/server.go",
  " (imports) L1-L7",
  " [struct] Server L9-L12",
  "  [field] Host L10; port L11",
  "  [method] Get L15",
  " [method] Server.Start L18-L22",
  " [func] NewServer L24-L26; main L28-L31",
  "```",
].join("\n");

interface MapperResult {
  symbols: LanguageSymbol[];
  failed: string[];
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
      description: DESCRIPTION,
      parameters: Type.Object({
        paths: Type.Array(Type.String({ minLength: 1 }), {
          description: "Files or directories to scan, no globs. Keep narrow",
          minItems: 1,
          uniqueItems: true,
        }),
        glob: Type.Optional(
          Type.String({ description: "Filter files found in directories, same as grep" }),
        ),
        kinds: Type.Optional(
          Type.Array(Type.String(), { description: "Filter symbols by kinds (default: all)" }),
        ),
      }),
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
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
            result.symbols.push(...(await collectSymbols(ctx.cwd, file, kinds)));
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            result.failed.push(`${file}: ${message}`);
          }
        }

        const outputLines = formatSymbols(result.symbols);
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
