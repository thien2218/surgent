import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { executeHashFlow, executePrFlow, executeUncommittedFlow } from "./flow.js";
import { describeSourceForRender, getSourceLabel, parseSourceSelector } from "./parser.js";
import type { CodeDiffToolDetails, CodeDiffToolParams } from "./types.js";

const codeDiffParameters = Type.Object({
  source: Type.Object(
    {
      pr: Type.Optional(Type.Number({ description: "GitHub pull request number", minimum: 1 })),
      hash: Type.Optional(
        Type.String({ description: "Source git commit hash (short or full SHA)" }),
      ),
      uncommitted: Type.Optional(
        Type.Boolean({ description: "Compare uncommitted local changes" }),
      ),
    },
    { additionalProperties: false },
  ),
  base: Type.Optional(
    Type.String({
      description:
        "Base git commit hash (required for source.hash, optional for source.uncommitted where default is HEAD)",
    }),
  ),
  files: Type.Optional(
    Type.Array(Type.String({ description: "File path to include in patch mode" })),
  ),
});

function createCodeDiffTool(pi: ExtensionAPI) {
  return defineTool({
    name: "code_diff",
    label: "Code Diff",
    description:
      "Compare code by GitHub PR (source.pr via gh), hash-to-hash (source.hash + base via git), or uncommitted changes.",
    promptSnippet:
      "Call without files first for summary. Use source.pr for PR diffs, source.hash with base for hash diffs, or source.uncommitted for local changes.",
    promptGuidelines: [
      "Set exactly one selector in source: pr or hash or uncommitted.",
      "When using source.pr, do not send base.",
      "When using source.hash, base is required and both values must be git hashes.",
      "When using source.uncommitted, base is optional and defaults to HEAD.",
      "Call code_diff without files first to discover changed files before patch requests.",
    ],
    parameters: codeDiffParameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (signal?.aborted) {
        throw new Error("code_diff was cancelled.");
      }

      const request = params as CodeDiffToolParams;
      const sourceSelector = parseSourceSelector(request.source);
      const sourceLabel = getSourceLabel(sourceSelector);
      const commandContext = { cwd: ctx.cwd, signal, pi };

      if (sourceSelector.kind === "pr") {
        return executePrFlow(request, sourceSelector.value, sourceLabel, commandContext);
      }

      if (sourceSelector.kind === "hash") {
        return executeHashFlow(request, sourceSelector.value, sourceLabel, commandContext);
      }

      return executeUncommittedFlow(request, sourceLabel, commandContext);
    },
    renderCall(args, theme) {
      const sourceLabel = describeSourceForRender(args.source);
      const files = Array.isArray(args.files) ? args.files : [];
      const modeLabel = files.length > 0 ? `patch:${files.length}` : "summary";
      const baseLabel = typeof args.base === "string" && args.base.trim() ? ` vs ${args.base}` : "";
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
