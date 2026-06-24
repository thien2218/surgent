import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type, type TObject, type TProperties } from "typebox";
import { executeHashFlow, executePrFlow, executeUncommittedFlow } from "./flow.js";
import type { CodeDiffToolDetails, CodeDiffToolParams } from "./types.js";

const FilesSchema = Type.Optional(
  Type.Array(Type.String({ description: "File path to include in patch mode" })),
);

function modeSchema(properties: TProperties): TObject<TProperties & { files: typeof FilesSchema }> {
  return Type.Object({ ...properties, files: FilesSchema }, { additionalProperties: false });
}

function createCodeDiffTool(pi: ExtensionAPI) {
  return defineTool({
    name: "code_diff",
    label: "Code Diff",
    description:
      "Compare code by mode: pr (GitHub PR via gh), hash (hash-to-hash via git), or uncommitted (working tree vs base/HEAD).",
    promptSnippet:
      "Call without files first for summary. Use mode=pr with pr, mode=hash with base+hash, or mode=uncommitted with optional base.",
    promptGuidelines: [
      "Set mode to one of: pr, hash, uncommitted.",
      "mode=pr requires pr number.",
      "mode=hash requires both base and hash (git commit hashes).",
      "mode=uncommitted supports optional base and defaults to HEAD.",
      "Call code_diff without files first to discover changed files before patch requests.",
    ],
    parameters: Type.Union([
      modeSchema({ mode: Type.Literal("pr"), pr: Type.Number({ minimum: 1 }) }),
      modeSchema({ mode: Type.Literal("hash"), base: Type.String(), hash: Type.String() }),
      modeSchema({ mode: Type.Literal("uncommitted"), base: Type.Optional(Type.String()) }),
    ]),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (signal?.aborted) {
        throw new Error("code_diff was cancelled.");
      }

      const request = params as CodeDiffToolParams;
      const commandContext = { cwd: ctx.cwd, signal, pi };

      if (request.mode === "pr") {
        return executePrFlow(
          { files: request.files },
          request.pr,
          `pr:${request.pr}`,
          commandContext,
        );
      }

      if (request.mode === "hash") {
        return executeHashFlow(
          { base: request.base, files: request.files },
          request.hash,
          `hash:${request.hash}`,
          commandContext,
        );
      }

      return executeUncommittedFlow(
        { base: request.base, files: request.files },
        "uncommitted",
        commandContext,
      );
    },
    renderCall(args, theme) {
      const files = Array.isArray(args.files) ? args.files : [];
      const modeLabel = files.length > 0 ? `patch:${files.length}` : "summary";
      const baseValue = "base" in args && typeof args.base === "string" ? args.base : undefined;
      const baseLabel = baseValue && baseValue.trim() ? ` vs ${baseValue}` : "";

      let sourceLabel: string;
      if (args.mode === "pr") {
        sourceLabel = `pr:${args.pr}`;
      } else if (args.mode === "hash") {
        sourceLabel = `hash:${args.hash}`;
      } else if (args.mode === "uncommitted") {
        sourceLabel = "uncommitted";
      } else {
        sourceLabel = "source";
      }

      return new Text(
        `${theme.fg("toolTitle", "code_diff")} ${sourceLabel}${baseLabel} (${modeLabel})`,
        0,
        0,
      );
    },
    renderResult(result, { isPartial }, theme) {
      if (isPartial) {
        return new Text(theme.fg("warning", "Computing diff..."), 0, 0);
      }

      const details = result.details as CodeDiffToolDetails | undefined;
      if (!details) {
        const firstContent = result.content[0];
        if (firstContent?.type === "text") {
          return new Text(firstContent.text, 0, 0);
        }
        return new Text(theme.fg("dim", "Diff ready"), 0, 0);
      }

      if (details.mode === "summary") {
        if (details.files.length === 0) {
          return new Text(theme.fg("dim", "No changed files"), 0, 0);
        }
        return new Text(theme.fg("success", `${details.files.length} files changed`), 0, 0);
      }

      if (!details.hasChanges) {
        return new Text(theme.fg("dim", "No changes in selected files"), 0, 0);
      }

      return new Text(
        theme.fg("success", `Patch ready for ${details.selectedFiles.length} files`),
        0,
        0,
      );
    },
  });
}

export default function registerCodeDiffTool(pi: ExtensionAPI) {
  pi.registerTool(createCodeDiffTool(pi));
}
