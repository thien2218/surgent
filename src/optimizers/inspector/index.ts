import { defineTool, keyHint } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { inspectParsedIds } from "./inspect.js";
import type { ParsedInspectorId } from "./types.js";

function parseInspectorIds(ids: string[]) {
  const parsedIds: ParsedInspectorId[] = [];

  for (const id of ids) {
    const trimmedId = id.trim();
    const separatorIndex = trimmedId.indexOf("#");
    if (separatorIndex <= 0 || separatorIndex >= trimmedId.length - 1) continue;

    const path = trimmedId.slice(0, separatorIndex).trim().replaceAll("\\", "/");
    const symbolPart = trimmedId.slice(separatorIndex + 1).trim();
    if (path.length === 0 || symbolPart.length === 0) continue;

    const suffixMatch = symbolPart.match(/~(\d+)$/);
    let name = symbolPart;

    if (suffixMatch) {
      const occurrenceText = suffixMatch[1];
      if (!occurrenceText) continue;

      const occurrence = Number(occurrenceText);
      if (!Number.isInteger(occurrence) || occurrence < 1) continue;

      name = symbolPart.slice(0, -suffixMatch[0].length);
      if (name.length === 0) continue;
    }

    const suffix = suffixMatch ? Number(suffixMatch[1]) : null;
    const orginal = suffix ? `${path}#${name}~${suffix}` : `${path}#${name}`;
    parsedIds.push({ orginal, path, name, suffix });
  }

  return parsedIds;
}

const inspect = defineTool({
  name: "inspect",
  label: "Inspect",
  description: "Inspect mapped abstractions by readable id.",
  parameters: Type.Object({
    ids: Type.Array(Type.String({ description: "Readable symbol id: <path>#<name>" }), {
      description: "Symbol ids to inspect",
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
    const parsedIds = parseInspectorIds(params.ids);

    if (parsedIds.length === 0) {
      return { isError: false, details: "", content: [{ type: "text", text: "" }] };
    }

    let inspectedSymbols: Array<{ id: string; location: [number, number]; text: string }> = [];
    try {
      inspectedSymbols = await inspectParsedIds(ctx.cwd, parsedIds, depth, signal);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        details: { error: "inspector failed", message },
        content: [{ type: "text", text: `inspector failed: ${message}` }],
      };
    }

    const detailsOutput = inspectedSymbols
      .map(
        (inspectedSymbol) =>
          `Inspected ${inspectedSymbol.id} depth=${typeof params.depth === "number" ? depth : "full"} lines=${inspectedSymbol.location[0]}-${inspectedSymbol.location[1]}`,
      )
      .join("\n");
    const contentOutput = inspectedSymbols
      .map((inspectedSymbol) => inspectedSymbol.text)
      .join("\n\n");

    return {
      isError: false,
      details: detailsOutput,
      content: [{ type: "text", text: contentOutput }],
    };
  },
  renderCall(args, theme) {
    const ids = Array.isArray(args.ids) ? args.ids.length : 0;
    const depth = typeof args.depth === "number" ? String(args.depth) : "full";
    return new Text(`${theme.fg("toolTitle", "inspector")} ids=${ids} depth=${depth}`, 0, 0);
  },
  renderResult(result, { isPartial, expanded }, theme) {
    if (isPartial) {
      return new Text(theme.fg("warning", "Inspecting..."), 0, 0);
    }

    const detailsText = typeof result.details === "string" ? result.details : "";
    const lines = detailsText.length > 0 ? detailsText.split("\n") : [];
    if (lines.length === 0) {
      return new Text(theme.fg("dim", "No symbols inspected"), 0, 0);
    }

    const maxLines = expanded ? lines.length : 10;
    const visible = lines.slice(0, maxLines);

    if (lines.length > maxLines) {
      visible.push(
        `... (${lines.length - maxLines} more lines, ${keyHint("app.tools.expand", "to expand")})`,
      );
    }

    return new Text(visible.join("\n"), 0, 0);
  },
});

export default inspect;
