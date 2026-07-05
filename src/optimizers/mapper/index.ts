import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type Parser from "tree-sitter";
import { defineTool, keyHint } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { resolveTargetPaths } from "./files.js";
import { createCodeParser } from "./parser.js";
import { collectSymbols } from "./symbols.js";
import type { MapperKind, MapperResult } from "./types.js";

const SUPPORTED_EXTENSIONS = new Set([".ts", ".tsx"]);

function normalizeExtension(extension: string) {
  const normalizedExtension = extension.trim().toLowerCase();
  return normalizedExtension.startsWith(".") ? normalizedExtension : `.${normalizedExtension}`;
}

const codeMapper = defineTool({
  name: "code_map",
  label: "Code map",
  description: "Snapshot of abstractions map in files.",
  parameters: Type.Object({
    targets: Type.Array(Type.String({ description: "Paths or globs to scan" }), {
      description: "Targets to map",
    }),
    extensions: Type.Array(Type.String({ description: "File extension, e.g. .ts" }), {
      minItems: 1,
      description: "File extensions to include",
    }),
    kinds: Type.Optional(
      Type.Array(
        Type.Union([
          Type.Literal("function"),
          Type.Literal("class"),
          Type.Literal("class_method"),
          Type.Literal("object_method"),
        ]),
        { description: "Abstraction kinds to include" },
      ),
    ),
    need: Type.Optional(
      Type.Array(Type.Union([Type.Literal("lines"), Type.Literal("container")]), {
        description: "Optional fields to include in output",
      }),
    ),
  }),
  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    const kinds = new Set<MapperKind>(
      params.kinds ?? ["function", "class", "class_method", "object_method"],
    );
    const fields = new Set(params.need ?? []);
    const result: MapperResult = { symbols: [], failed: [] };
    const extensions = new Set(params.extensions.map(normalizeExtension));
    const unsupported = extensions.difference(SUPPORTED_EXTENSIONS);

    if (unsupported.size > 0) {
      const unsupportedText = [...unsupported].join(", ");
      return {
        isError: true,
        details: {
          error: "mapper target validation failed",
          message: `unsupported extensions: ${unsupportedText}`,
        },
        content: [
          {
            type: "text",
            text: `mapper target validation failed: unsupported extensions: ${unsupportedText}`,
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
        details: `mapper target scan failed: ${message}`,
        content: [{ type: "text", text: `mapper target scan failed: ${message}` }],
      };
    }

    if (paths.length === 0) {
      return { isError: false, details: "", content: [{ type: "text", text: "" }] };
    }

    const parsers = new Map<string, Parser>();
    for (const extension of extensions) {
      try {
        parsers.set(extension, await createCodeParser(extension));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          details: `mapper init failed: ${message}`,
          content: [{ type: "text", text: `mapper init failed: ${message}` }],
        };
      }
    }

    for (const path of paths) {
      if (signal?.aborted) {
        return {
          isError: true,
          details: "mapper aborted",
          content: [{ type: "text", text: "mapper aborted" }],
        };
      }

      const absolutePath = resolve(ctx.cwd, path);
      try {
        const code = await readFile(absolutePath, "utf8");
        const parser = parsers.get(extname(path).toLowerCase());
        if (!parser) {
          result.failed.push(path);
          continue;
        }

        const tree = parser.parse(code);
        result.symbols.push(...collectSymbols(tree.rootNode, path, kinds, fields));
      } catch {
        result.failed.push(path);
      }
    }

    const output = result.symbols
      .map((symbol) => {
        let line = `${symbol.kind} ${symbol.id}`;
        if (symbol.lines) {
          line += ` lines:${symbol.lines[0]}-${symbol.lines[1]}`;
        }
        if (symbol.container) {
          line += ` container:${symbol.container}`;
        }
        return line;
      })
      .join("\n");

    return { isError: false, details: output, content: [{ type: "text", text: output }] };
  },
  renderCall(args, theme) {
    const targets = Array.isArray(args.targets) ? args.targets.join(", ") : "";
    const extensions = Array.isArray(args.extensions) ? args.extensions.join(", ") : "";
    const kinds = Array.isArray(args.kinds) ? args.kinds.join(", ") : "default";
    const need = Array.isArray(args.need) && args.need.length > 0 ? args.need.join(", ") : "none";

    return new Text(
      `${theme.fg("toolTitle", "mapper")} targets=[${targets}] extensions=[${extensions}] kinds=[${kinds}] need=[${need}]`,
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

export default codeMapper;
