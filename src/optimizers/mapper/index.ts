import { defineTool, keyHint } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { resolveTargetPaths } from "./files.js";
import { getSupportedExtensions, collectSymbols, SYMBOL_KINDS } from "../languages/index.js";
import type { MapperResult } from "./types.js";

function normalizeExtension(extension: string) {
  const normalized = extension.trim().toLowerCase();
  return normalized.startsWith(".") ? normalized : `.${normalized}`;
}

const codeMap = defineTool({
  name: "code_map",
  label: "Code map",
  description:
    "Fast symbol indexing. Best for: narrowing targets to inspect/read, or overall code understanding/discovery.",
  parameters: Type.Object({
    targets: Type.Array(Type.String(), {
      description: "Paths or globs to scan (relative to cwd). Keep scope narrow.",
    }),
    extensions: Type.Array(Type.String({ description: "File extension, e.g. .ts" }), {
      minItems: 1,
      description: "File extensions to include (e.g. `.ts`).",
    }),
    kinds: Type.Optional(
      Type.Array(Type.Union(SYMBOL_KINDS.map((kind) => Type.Literal(kind))), {
        description: "Abstraction kinds to include. Omit to include all supported.",
      }),
    ),
    need: Type.Optional(
      Type.Array(Type.Union([Type.Literal("range"), Type.Literal("container")]), {
        description: "Optional fields added to each output row",
      }),
    ),
  }),
  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    const kinds = new Set(params.kinds ?? SYMBOL_KINDS);
    const fields = new Set(params.need ?? []);
    const result: MapperResult = { symbols: [], failed: [] };
    const extensions = new Set(params.extensions.map(normalizeExtension));
    const unsupported = extensions.difference(getSupportedExtensions());

    if (unsupported.size > 0) {
      const unsupportedText = [...unsupported].join(", ");
      return {
        isError: true,
        details: "code_map target validation failed",
        content: [
          {
            type: "text",
            text: `code_map target validation failed: unsupported extensions: ${unsupportedText}`,
          },
        ],
      };
    }

    let paths: string[] = [];
    try {
      paths = await resolveTargetPaths(ctx.cwd, params.targets, extensions, signal);
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
        const symbols = await collectSymbols(ctx.cwd, path, kinds, fields);
        result.symbols.push(...symbols);
      } catch {
        result.failed.push(path);
      }
    }

    const outputLines = result.symbols.map((symbol) => {
      let line = ` ${symbol.path} ${symbol.kind} symbol=${symbol.name}`;
      if (symbol.range) {
        line += ` range:${symbol.range[0]}-${symbol.range[1]}`;
      }
      if (symbol.container) {
        line += ` container:${symbol.container}`;
      }
      return line;
    });

    if (result.failed.length > 0) {
      outputLines.push(...result.failed.map((path) => `failed ${path}`));
    }
    if (outputLines.length === 0) {
      outputLines.push("(no symbols found) targets matched no supported files or symbols");
    }

    const output = outputLines.join("\n");
    return { isError: false, details: output, content: [{ type: "text", text: output }] };
  },
  renderCall(args, theme) {
    const targets = Array.isArray(args.targets) ? args.targets.join(", ") : "";
    const extensions = Array.isArray(args.extensions) ? args.extensions.join(", ") : "";
    const kinds = Array.isArray(args.kinds) ? args.kinds.join(", ") : "default";
    const need = Array.isArray(args.need) && args.need.length > 0 ? args.need.join(", ") : "none";

    return new Text(
      `${theme.fg("toolTitle", "code_map")} targets=[${targets}] extensions=[${extensions}] kinds=[${kinds}] need=[${need}]`,
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
