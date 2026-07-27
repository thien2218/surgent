import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { isReadToolResult, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parseInspectToolDetails } from "../inspector/helpers.js";
import type { Range } from "../inspector/types.js";
import { type DeduplicatedFile, mergeRanges, reconcileTouched, subtractRanges } from "./helpers.js";

export default function (pi: ExtensionAPI) {
  const files = new Map<string, DeduplicatedFile>();

  pi.on("session_start", () => files.clear());
  pi.on("session_tree", () => files.clear());

  pi.on("tool_result", async (event, ctx) => {
    if (event.isError || (event.toolName !== "read" && event.toolName !== "inspect")) return;
    if (event.content.length !== 1 || event.content[0]?.type !== "text") return;

    let sourcePath: string;
    let ranges: Range[];
    let continuation: string | undefined;

    if (isReadToolResult(event)) {
      const originalText = event.content[0].text;
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

      continuation = originalText.match(/\n\n\[[^\n]*Use offset=\d+ to continue\.\]$/)?.[0];
      const visibleText = continuation ? originalText.slice(0, -continuation.length) : originalText;
      const visibleLines = truncation?.truncated
        ? truncation.outputLines
        : visibleText.split("\n").length;
      if (visibleLines <= 0) return;

      sourcePath = inputPath;
      const start = inputOffset ?? 1;
      ranges = [[start, start + visibleLines - 1]];
    } else {
      const details = parseInspectToolDetails(event.details);
      if (!details) return;
      sourcePath = details.path;
      ranges = details.ranges;
    }

    let canonicalPath: string;
    let currentContent: string[];
    try {
      canonicalPath = await realpath(resolve(ctx.cwd, sourcePath));
      currentContent = (await readFile(canonicalPath, "utf8")).split("\n");
    } catch {
      return;
    }

    if (ranges.length === 0) return;

    const storedFile = files.get(canonicalPath);
    if (!storedFile) {
      files.set(canonicalPath, { content: currentContent, touched: ranges });
      return;
    }

    const reconciled = reconcileTouched(storedFile.content, currentContent, storedFile.touched);
    storedFile.content = currentContent;
    storedFile.touched = reconciled.touched;

    const hasTouchedLines = ranges.some(([start, end]) =>
      storedFile.touched.some(
        ([touchedStart, touchedEnd]) => touchedStart <= end && touchedEnd >= start,
      ),
    );
    if (!hasTouchedLines) {
      storedFile.touched = mergeRanges([...storedFile.touched, ...ranges]);
      return;
    }

    const unseenRanges = subtractRanges(ranges, storedFile.touched);
    storedFile.touched = mergeRanges([...storedFile.touched, ...ranges]);
    if (unseenRanges.length === 0) {
      return { content: [{ type: "text", text: "(no changes made since last read)" }] };
    }

    let text = unseenRanges
      .map(([start, end]) => currentContent.slice(start - 1, end).join("\n"))
      .join("\n...\n");

    if (continuation) text += continuation;

    return { content: [{ type: "text", text }] };
  });
}
