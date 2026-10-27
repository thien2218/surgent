import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { inspectSymbol } from "./inspect.js";
import { normalizeToolPath } from "../deduplicator/resources.js";

export interface InspectToolDetails {
  path: string;
  symbol: string;
}

const inspect = defineTool({
  name: "inspect",
  label: "Inspect",
  description:
    "Fetch one symbol's body from one file, optionally collapsing nested code blocks to save context.",
  parameters: Type.Object({
    path: Type.String({
      description: "Exact file path containing target symbol (relative to cwd or absolute)",
    }),
    symbol: Type.String({
      description:
        "Exact symbol string for one declaration in file: function name, class name, method name (MyClass.method), synthetic name (<anonymous>, <imports>, <exports>), or later duplicate form name#1",
    }),
    depth: Type.Optional(
      Type.Integer({
        minimum: 0,
        description:
          "Maximum code-block depth: 0 keeps signatures only, 1 keeps outer bodies. Omit for full source.",
      }),
    ),
  }),
  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    const path = normalizeToolPath(params.path, ctx.cwd, "inspect");
    const symbol = params.symbol.trim();
    if (symbol.length === 0) {
      return {
        isError: true,
        details: null,
        content: [
          {
            type: "text",
            text: "inspect symbol format invalid. path/symbol must be non-empty. Use symbol name, e.g. name or name#1",
          },
        ],
      };
    }

    try {
      const inspected = await inspectSymbol(ctx.cwd, path, symbol, params.depth, signal);
      if (!inspected) {
        return {
          isError: true,
          details: null,
          content: [
            {
              type: "text",
              text: "inspect symbol not found. verify path/symbol; for later duplicates use #n suffix (name#1). then try container symbol. if still missing, run code_map with broader kinds",
            },
          ],
        };
      }

      return { isError: false, details: null, content: [{ type: "text", text: inspected.text }] };
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
    return new Text(
      `${theme.fg("toolTitle", "inspect")} ${theme.underline(theme.fg("accent", args.path))} ${theme.fg("warning", args.symbol)}`,
      0,
      0,
    );
  },
  renderResult(result, { expanded }, theme, context) {
    if (!expanded && !context.isError) {
      return new Text("", 0, 0);
    }

    const output = result.content[0];
    return new Text(
      `\n${output?.type === "text" ? theme.fg("toolOutput", output.text) : ""}`,
      0,
      0,
    );
  },
});

export default inspect;
