import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { isReadToolResult, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parseInspectToolDetails } from "../inspector/helpers.js";
import type { Range } from "../inspector/types.js";
import { mergeRanges, reconcileTouched, subtractRanges } from "./helpers.js";
import type { DeduplicatedFile } from "./types.js";
import { readSessionEntries } from "../entries.js";
import { filterDeduplicatedMessages } from "./context.js";
import { buildDeduplicatorState } from "./state.js";

function withOriginalContent(details: unknown, originalContent: string) {
  const preservedDetails =
    details && typeof details === "object" && !Array.isArray(details)
      ? (details as Record<string, unknown>)
      : {};
  return { ...preservedDetails, originalContent };
}

export default function (pi: ExtensionAPI) {
  const files = new Map<string, DeduplicatedFile>();
  let state = buildDeduplicatorState([], null, "");

  pi.on("session_compact", () => files.clear());

  pi.on("session_start", (_event, ctx) => {
    files.clear();
    const entries = readSessionEntries(ctx.sessionManager.getSessionFile()) ?? [];
    state = buildDeduplicatorState(entries, ctx.sessionManager.getLeafId(), ctx.cwd);
  });

  pi.on("session_tree", (event, ctx) => {
    files.clear();
    const entries = readSessionEntries(ctx.sessionManager.getSessionFile()) ?? [];
    state = buildDeduplicatorState(entries, event.newLeafId, ctx.cwd);
  });

  pi.on("context", (event) => {
    const deduplicated = filterDeduplicatedMessages(event.messages, state);
    if (deduplicated.changed) return { messages: deduplicated.messages };
  });

  pi.on("tool_result", async (event, ctx) => {
    if (event.isError || (event.toolName !== "read" && event.toolName !== "inspect")) return;
    if (event.content.length !== 1 || event.content[0]?.type !== "text") return;

    const originalContent = event.content[0].text;
    let sourcePath: string;
    let range: Range;
    let continuation: string | undefined;

    if (isReadToolResult(event)) {
      const inputPath = event.input.path;
      const inputOffset = event.input.offset;
      const inputLimit = event.input.limit;
      if (
        typeof inputPath !== "string" ||
        (inputOffset !== undefined &&
          (typeof inputOffset !== "number" || !Number.isInteger(inputOffset) || inputOffset < 1)) ||
        (inputLimit !== undefined &&
          (typeof inputLimit !== "number" || !Number.isInteger(inputLimit) || inputLimit < 1))
      ) {
        return;
      }

      const truncation = event.details?.truncation;
      if (truncation?.firstLineExceedsLimit) return;

      continuation = originalContent.match(/\n\n\[[^\n]*Use offset=\d+ to continue\.\]$/)?.[0];
      const toSlice = continuation ? -continuation.length : undefined;

      const visibleLines = truncation?.truncated
        ? truncation.outputLines
        : originalContent.slice(0, toSlice).split("\n").length;
      if (visibleLines <= 0) return;

      sourcePath = inputPath;
      const start = inputOffset ?? 1;
      range = [start, start + visibleLines - 1];
    } else {
      const details = parseInspectToolDetails(event.details);
      if (!details) return;
      sourcePath = details.path;
      range = details.range;
    }

    let canonicalPath: string;
    let currentContent: string[];
    try {
      canonicalPath = await realpath(resolve(ctx.cwd, sourcePath));
      currentContent = (await readFile(canonicalPath, "utf8")).split("\n");
    } catch {
      return;
    }

    const storedFile = files.get(canonicalPath);
    if (!storedFile) {
      files.set(canonicalPath, { content: currentContent, touched: [range] });
      return;
    }

    reconcileTouched(storedFile, currentContent);
    const unseenRanges = subtractRanges([range], storedFile.touched);
    storedFile.touched = mergeRanges([...storedFile.touched, range]);

    if (unseenRanges.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "(content from previous read/inspect is still valid, use prior output)",
          },
        ],
        details: withOriginalContent(event.details, originalContent),
      };
    }

    if (
      unseenRanges.length === 1 &&
      unseenRanges[0]![0] === range[0] &&
      unseenRanges[0]![1] === range[1]
    ) {
      return;
    }

    let text = unseenRanges
      .map(
        ([start, end]) =>
          `@@ lines ${start}-${end} @@\n${currentContent.slice(start - 1, end).join("\n")}`,
      )
      .join("\n...\n");
    if (continuation) text += continuation;

    return {
      content: [{ type: "text", text }],
      details: withOriginalContent(event.details, originalContent),
    };
  });
}
