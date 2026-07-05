import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { parseInspectToolDetails } from "./helpers.js";
import { inspectSymbol } from "./inspect.js";
import type { InspectToolDetails } from "./types.js";

const inspect = defineTool({
  name: "inspect",
  label: "Inspect",
  description:
    "Fetch one symbol body from one file. Good for targeted edits without full read; omit depth for exact body text. For duplicates, use ~n suffix (example: name~2).",
  parameters: Type.Object({
    path: Type.String({
      description: "Exact file path containing target symbol (relative to cwd or absolute)",
    }),
    symbol: Type.String({
      description: "Symbol name in file: <symbol> or duplicate form <symbol>~n",
    }),
    depth: Type.Optional(
      Type.Integer({
        minimum: 0,
        description:
          "Nested expansion depth. Lower depth may collapse blocks with '…'; omit for exact symbol body text.",
      }),
    ),
  }),
  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    const depth = typeof params.depth === "number" ? params.depth : Number.POSITIVE_INFINITY;
    const depthLabel = typeof params.depth === "number" ? params.depth : "full";
    const path = params.path.trim().replaceAll("\\", "/");
    const symbol = params.symbol.trim();

    if (path.length === 0 || symbol.length === 0 || symbol.includes("#")) {
      return {
        isError: false,
        details: null,
        content: [
          {
            type: "text",
            text: "inspect symbol format invalid. path/symbol must be non-empty; symbol cannot include '#'. use symbol name, e.g. name or name~2",
          },
        ],
      };
    }

    try {
      const inspected = await inspectSymbol(ctx.cwd, path, symbol, depth, signal);
      if (!inspected) {
        return {
          isError: false,
          details: null,
          content: [
            {
              type: "text",
              text: "inspect symbol not found. verify path and symbol name; for duplicates use ~n suffix (example: name~2)",
            },
          ],
        };
      }

      const details = {
        path: inspected.path,
        symbol: inspected.symbol,
        depth: depthLabel,
        lines: [inspected.lines[0], inspected.lines[1]],
      } satisfies InspectToolDetails;

      return { isError: false, details, content: [{ type: "text", text: inspected.text }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        details: null,
        content: [{ type: "text", text: `inspect failed: ${message}` }],
      };
    }
  },
  renderCall(args, theme) {
    const depth = typeof args.depth === "number" ? String(args.depth) : "full";
    return new Text(
      `${theme.fg("toolTitle", "inspect")} path=${args.path} symbol=${args.symbol} depth=${depth}`,
      0,
      0,
    );
  },
  renderResult(result, { isPartial }, theme) {
    if (isPartial) {
      return new Text(theme.fg("warning", "Inspecting..."), 0, 0);
    }
    const details = parseInspectToolDetails(result.details);
    const output = details
      ? `Inspected ${details.path} ${details.symbol} depth=${details.depth} lines=${details.lines[0]}-${details.lines[1]}`
      : "";
    return new Text(output, 0, 0);
  },
});

export default inspect;
