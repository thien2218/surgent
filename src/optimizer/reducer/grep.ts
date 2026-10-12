import { stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  createGrepToolDefinition,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { FileCheck } from "../../permission/types.js";
import { expandFilePath, resolveReadGrant } from "../../permission/resolution.js";
import { getState, type AppState } from "../../state.js";
import Type from "typebox";
import { askForPermission } from "../../permission/index.js";

const GREP_NOTICE =
  /^\[(?:\d+ matches limit reached\. Use limit=\d+ for more, or refine pattern(?:\. )?)?(?:[\d.]+KB limit reached(?:\. )?)?(?:Some lines truncated to \d+ chars\. Use read tool to see full lines)?\]$/;
const GREP_CONTENT = /^\d+[:-] /;

function formatGrepResult(content: string): string[] {
  const formattedLines: string[] = [];
  const formattedIndexes = new Map<string, number>();
  let currentFilePath: string | undefined;

  for (const line of content.split("\n")) {
    if (line.includes("\r")) throw new Error("Cannot authorize malformed grep output");

    const matchLine = line.match(/^(.+?):(\d+): (.*)$/);
    const contextLine = matchLine ? null : line.match(/^(.+?)-(\d+)- (.*)$/);
    const filePath = matchLine?.[1] ?? contextLine?.[1];
    const lineNumber = matchLine?.[2] ?? contextLine?.[2];
    const lineText = matchLine?.[3] ?? contextLine?.[3];

    if (!filePath || !lineNumber || lineText === undefined) {
      formattedLines.push(line);
      continue;
    }

    const lineKey = `${filePath}\0${lineNumber}`;
    const formattedIndex = formattedIndexes.get(lineKey);
    if (formattedIndex !== undefined) {
      if (matchLine) formattedLines[formattedIndex] = `${lineNumber}: ${lineText}`;
      continue;
    }

    if (filePath !== currentFilePath) {
      formattedLines.push(filePath);
      currentFilePath = filePath;
    }
    formattedIndexes.set(lineKey, formattedLines.length);
    formattedLines.push(`${lineNumber}${matchLine ? ":" : "-"} ${lineText}`);
  }

  return formattedLines;
}

async function filterGrepResult(
  lines: string[],
  path: string,
  state: AppState,
  ctx: ExtensionContext,
): Promise<{ text: string; check: FileCheck | undefined }> {
  if (lines.length === 1 && lines[0] === "No matches found") {
    return { text: "No matches found", check: undefined };
  }

  const searchPath = expandFilePath(path, ctx.cwd);
  if (!searchPath) throw new Error("Missing grep search path");

  let check: FileCheck | undefined;
  let filePath: string | undefined;
  const denied: string[] = [];
  const isDirectory = (await stat(searchPath)).isDirectory();
  const decisions = new Map<string, boolean>();
  const retained: string[] = [];

  for (const [lineIdx, text] of lines.entries()) {
    if (text === "" || (lineIdx === lines.length - 1 && GREP_NOTICE.test(text))) {
      retained.push(text);
      continue;
    }
    if (GREP_CONTENT.test(text)) {
      if (!filePath) throw new Error("Cannot authorize grep content without a file");
      if (decisions.get(filePath)) retained.push(text);
      continue;
    }
    if (!isDirectory && text !== basename(searchPath)) {
      throw new Error("Cannot resolve grep result path");
    }

    filePath = isDirectory ? resolve(searchPath, text) : searchPath;
    if (!decisions.has(filePath)) {
      const grant = await resolveReadGrant(filePath, state, ctx);
      if (grant.check) {
        check ??= grant.check;
        check.raw += `\n${filePath}`;
      }
      denied.push(...grant.denied);
      decisions.set(filePath, grant.denied.length === 0);
    }
    if (decisions.get(filePath)) {
      retained.push(text);
    }
  }

  if (denied && denied.length > 0) {
    retained.push(
      `[Search results exclude files blocked by permission rules: ${[...new Set(denied)].join(", ")}]`,
    );
  }
  return { text: retained.join("\n"), check };
}

export default function grep(pi: ExtensionAPI) {
  const grepTool = createGrepToolDefinition(process.cwd());

  pi.registerTool({
    ...grepTool,
    parameters: Type.Object({
      ...grepTool.parameters.properties,
      context: Type.Optional(
        Type.Number({
          description:
            "Number of lines to show before and after each match (default: 0). Context lines are later stripped to reduce optimize context; they're still shown when requested",
          maximum: 2,
        }),
      ),
    }),
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      const result = await grepTool.execute(toolCallId, params, signal, undefined, ctx);
      const state = getState(pi);
      const formatted = formatGrepResult(
        result.content.map((item) => (item.type === "text" ? item.text : "")).join("\n"),
      );
      const { text, check } = await filterGrepResult(formatted, params.path || ".", state, ctx);

      if (state.getMode() !== "yolo" && check) {
        const decision = await askForPermission(pi, ctx, check);
        if (decision?.block) throw new Error(decision.reason);
      }
      // Truncation contains raw text and pre-filter counts; only search-limit flags remain valid.
      return {
        content: [{ type: "text", text }],
        details: result.details && {
          matchLimitReached: result.details.matchLimitReached,
          linesTruncated: result.details.linesTruncated,
        },
      };
    },
  });
}
