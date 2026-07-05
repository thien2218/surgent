import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { parseInspectorId, parseInspectToolDetails } from "./helpers.js";
import { inspectParsedId } from "./inspect.js";
import type { InspectToolDetails } from "./types.js";

const inspect = defineTool({
  name: "inspect",
  label: "Inspect",
  description: "Inspect mapped abstractions by readable id.",
  parameters: Type.Object({
    id: Type.String({
      description: "Symbol id to inspect: <path>#<name>",
    }),
    depth: Type.Optional(
      Type.Integer({
        minimum: 0,
        description:
          "Collapse depth. Omit for full text, 0 collapses bodies to …, 1+ expands nested levels.",
      }),
    ),
  }),
  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    const depth = typeof params.depth === "number" ? params.depth : Number.POSITIVE_INFINITY;
    const depthLabel = typeof params.depth === "number" ? params.depth : "full";
    const parsedId = parseInspectorId(params.id);
    if (!parsedId) {
      return { isError: false, details: null, content: [{ type: "text", text: "(no output)" }] };
    }

    try {
      const inspected = await inspectParsedId(ctx.cwd, parsedId, depth, signal);
      if (!inspected) {
        return { isError: false, details: null, content: [{ type: "text", text: "(no output)" }] };
      }

      const details = {
        id: inspected.id,
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
    return new Text(`${theme.fg("toolTitle", "inspect")} id=${args.id} depth=${depth}`, 0, 0);
  },
  renderResult(result, { isPartial }, theme) {
    if (isPartial) {
      return new Text(theme.fg("warning", "Inspecting..."), 0, 0);
    }
    const details = parseInspectToolDetails(result.details);
    const output = details
      ? `Inspected ${details.id} depth=${details.depth} lines=${details.lines[0]}-${details.lines[1]}`
      : "";
    return new Text(output, 0, 0);
  },
});

export default inspect;
