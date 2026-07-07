import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { inspectSymbol } from "./inspect.js";
import type { InspectToolDetails } from "./types.js";

const inspect = defineTool({
  name: "inspect",
  label: "Inspect",
  description:
    "Fetch one symbol body from one file. Output is safe for targeted edits; omit depth for exact body text.",
  parameters: Type.Object({
    path: Type.String({
      description: "Exact file path containing target symbol (relative to cwd or absolute)",
    }),
    symbol: Type.String({
      description:
        "Exact symbol string for one declaration in file: function name, class name, method name (MyClass.method), synthetic anonymous name (anonymous@L12), or duplicate form name~2",
    }),
    depth: Type.Optional(
      Type.Integer({
        minimum: 0,
        description:
          "Nested expansion depth. Lower depth collapse blocks to save resource; increase to expand or omit for exact symbol body text. Prefer lower value on first round.",
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
              text: "inspect symbol not found. verify path/symbol; for duplicates use ~n suffix (name~2). then try container symbol. if still missing, rerun symbol index with broader kinds",
            },
          ],
        };
      }

      const details = {
        path: inspected.path,
        symbol: inspected.symbol,
        depth: depthLabel,
        range: [inspected.range[0], inspected.range[1]],
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
  renderResult() {
    return new Text("", 0, 0);
  },
});

export default inspect;
