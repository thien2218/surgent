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

    const orginal = `${path}#${name}~${suffixMatch ? "~" + Number(suffixMatch[1]) : ""}`;
    parsedIds.push({ orginal, path, name, suffix: suffixMatch && Number(suffixMatch[1]) });
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
    need: Type.Optional(
      Type.Array(
        Type.Union([Type.Literal("signature"), Type.Literal("body"), Type.Literal("location")]),
        { description: "Fields to return" },
      ),
    ),
    depth: Type.Optional(
      Type.Integer({
        minimum: 0,
        description: "Body expansion depth. Used only when need includes body. 0 = top-level only.",
      }),
    ),
  }),
  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    const needs = new Set(
      params.need && params.need.length > 0 ? params.need : ["signature", "location"],
    );
    const depth = needs.has("body") ? Math.max(0, params.depth ?? 0) : 0;
    const parsedIds = parseInspectorIds(params.ids);

    if (parsedIds.length === 0) {
      return { isError: false, details: "", content: [{ type: "text", text: "" }] };
    }

    try {
      await inspectParsedIds(ctx.cwd, parsedIds, needs, depth, signal);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        details: { error: "inspector failed", message },
        content: [{ type: "text", text: `inspector failed: ${message}` }],
      };
    }

    const output = parsedIds
      .map((parsedId) => `Inspected ${parsedId.orginal} [${[...needs].join(", ")}]`)
      .join("\n");

    return { isError: false, details: output, content: [{ type: "text", text: output }] };
  },
  renderCall(args, theme) {
    const ids = Array.isArray(args.ids) ? args.ids.length : 0;
    const need =
      Array.isArray(args.need) && args.need.length > 0 ? args.need.join(", ") : "default";
    const depth = typeof args.depth === "number" ? String(args.depth) : "0";

    return new Text(
      `${theme.fg("toolTitle", "inspector")} ids=${ids} need=[${need}] depth=${depth}`,
      0,
      0,
    );
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
