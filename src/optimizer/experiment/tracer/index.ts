import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { normalizeToolPath } from "../../../utils.js";
import { buildCallTree } from "./tree.js";

const callTree = defineTool({
  name: "call_tree",
  label: "Call Tree",
  description:
    "Trace who calls a function or method (incoming), or what it calls (outgoing), across multiple levels.",
  parameters: Type.Object({
    mode: Type.Union([Type.Literal("incoming"), Type.Literal("outgoing")]),
    symbol: Type.String({
      description:
        "Function/method name from code_map or inspect, including Type.member and #n suffixes",
    }),
    file: Type.String({ description: "File containing the function or method" }),
    maxDepth: Type.Optional(
      Type.Integer({ minimum: 1, default: 3, description: "Maximum edges from root" }),
    ),
  }),
  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    try {
      if (!params.file.trim() || !params.symbol.trim()) {
        throw new Error("file and symbol must be non-empty");
      }

      const text = await buildCallTree(
        ctx.cwd,
        {
          ...params,
          file: normalizeToolPath(params.file, ctx.cwd),
          symbol: params.symbol.trim(),
        },
        signal,
      );
      return { isError: false, details: null, content: [{ type: "text" as const, text }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        details: null,
        content: [{ type: "text" as const, text: `call_tree failed: ${message}` }],
      };
    }
  },
  renderCall(args, theme) {
    return new Text(
      `${theme.fg("toolTitle", "call_tree")} ${theme.fg("accent", args.file)} ${theme.fg("warning", args.symbol)} ${theme.fg("dim", args.mode)}`,
      0,
      0,
    );
  },
  renderResult(result, { expanded }, theme, context) {
    if (!expanded && !context.isError) return new Text("", 0, 0);
    const output = result.content[0];
    return new Text(output?.type === "text" ? theme.fg("toolOutput", output.text) : "", 0, 0);
  },
});

export default callTree;
