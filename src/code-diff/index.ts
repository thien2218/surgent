import { defineTool, type ExecResult, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { executeFlow } from "./flow.js";
import type { CodeDiffToolDetails, CodeDiffToolParams } from "./types.js";

function formatCommand(command: string, argumentsList: string[]) {
  const quotedArguments = argumentsList.map((argumentValue) =>
    /\s/.test(argumentValue) ? JSON.stringify(argumentValue) : argumentValue,
  );
  return [command, ...quotedArguments].join(" ");
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
    parameters: Type.Object(
      {
        mode: Type.Union(
          [
            Type.Literal("pr", { description: "GitHub PR diff mode" }),
            Type.Literal("hash", { description: "Git commit hash-to-hash diff mode" }),
            Type.Literal("uncommitted", {
              description: "Working tree diff mode against base (or HEAD by default)",
            }),
          ],
          { description: "Diff mode selector" },
        ),
        pr: Type.Optional(
          Type.Number({
            minimum: 1,
            description: "GitHub pull request number. Required when mode=pr",
          }),
        ),
        base: Type.Optional(
          Type.String({
            description: "Base git commit hash or ref. Required when mode=hash, optional for uncommitted",
          }),
        ),
        hash: Type.Optional(
          Type.String({
            description: "Target git commit hash or ref. Required when mode=hash",
          }),
        ),
        files: Type.Optional(
          Type.Array(
            Type.String({ description: "File path to include in patch mode" }),
            { description: "Optional list of file paths to limit patch output" },
          ),
        ),
      },
      { additionalProperties: false },
    ),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (signal?.aborted) {
        throw new Error("code_diff was cancelled.");
      }

      async function runCommand(cmd: string, args: string[], desc?: string) {
        let result: ExecResult;
        const formatted = formatCommand(cmd, args);

        try {
          result = await pi.exec(cmd, args, { cwd: ctx.cwd, signal });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to start command: ${formatted}\n${message}`);
        }

        const stdoutOutput = result.stdout.trim();
        const stderrOutput = result.stderr.trim();
        const output = stderrOutput || stdoutOutput || "No output.";
        const description = desc ?? "Failed to run command";

        if (result.code !== 0) {
          throw new Error(`${description}: ${formatted} (exit ${result.code})\n${output}`);
        }

        return result;
      }

      return executeFlow(params as CodeDiffToolParams, runCommand);
    },
    renderCall(args, theme) {
      const filesValue = args.files;
      const files = Array.isArray(filesValue)
        ? filesValue.filter((filePath): filePath is string => typeof filePath === "string")
        : [];
      const modeLabel = files.length > 0 ? `patch:${files.length}` : "summary";

      const modeValue = typeof args.mode === "string" ? args.mode : undefined;
      const baseValue = typeof args.base === "string" ? args.base : undefined;
      const baseLabel = baseValue && baseValue.trim() ? ` vs ${baseValue}` : "";

      let sourceLabel = "source";
      if (modeValue === "pr") {
        const prValue = typeof args.pr === "number" ? args.pr : "?";
        sourceLabel = `pr:${prValue}`;
      } else if (modeValue === "hash") {
        const hashValue = typeof args.hash === "string" ? args.hash : "?";
        sourceLabel = `hash:${hashValue}`;
      } else if (modeValue === "uncommitted") {
        sourceLabel = "uncommitted";
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
