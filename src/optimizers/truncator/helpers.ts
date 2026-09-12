import {
  appendFileSync,
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import type { BashToolDetails } from "@earendil-works/pi-coding-agent";

export function extractBashSummary(text: string, details?: BashToolDetails): string {
  const truncation = details?.truncation;

  if (truncation?.truncated) {
    const startLine = truncation.totalLines - truncation.outputLines + 1;
    const endLine = truncation.totalLines;
    const partialLastLine = truncation.lastLinePartial === true ? "true" : "false";
    return `Bash output=tail:L${startLine}-L${endLine}/L${truncation.totalLines} | partialLastLine=${partialLastLine}`;
  }

  const outputState = !text.trim() || text.trim() === "(no output)" ? "none" : "present";
  return `Bash output=${outputState}`;
}

export function extractGrepSummary(contentText: string): string | null {
  if (contentText === "No matches found") return null;
  const notice = contentText.match(/\n\n(\[[^\n]+\])$/)?.[1];

  const fileLines = new Map<string, Set<number>>();
  const contentLines = contentText.split("\n");
  let filePath: string | undefined;
  let matched = false;

  for (let lineIndex = 0; lineIndex < contentLines.length; lineIndex++) {
    const contentLine = contentLines[lineIndex] ?? "";
    const lineMatch = contentLine.match(/^(\d+): /);
    if (!lineMatch) {
      const nextLine = contentLines[lineIndex + 1] ?? "";
      if (contentLine && !/^\d+- /.test(contentLine) && /^\d+[:-] /.test(nextLine)) {
        filePath = contentLine;
      }
      continue;
    }

    const lineNumStr = lineMatch[1];
    if (!filePath || !lineNumStr) continue;

    matched = true;
    const lineNum = parseInt(lineNumStr, 10);
    const existing = fileLines.get(filePath);
    if (existing) {
      existing.add(lineNum);
    } else {
      fileLines.set(filePath, new Set([lineNum]));
    }
  }

  if (!matched) return null;

  return (
    Array.from(fileLines.entries())
      .map(([filePath, lines]) => `${filePath}: lines_matched=[${Array.from(lines).join(", ")}]`)
      .join("\n") + (notice ? `\n\n${notice}` : "")
  );
}

export function rewriteTailWithSummaries(
  sessionFile: string,
  offset: number,
  summaries: Map<string, string>,
) {
  if (summaries.size === 0) return;

  const sessionBuffer = readFileSync(sessionFile);
  if (offset > sessionBuffer.length) return;

  const prefixBuffer = sessionBuffer.subarray(0, offset);
  const tailText = sessionBuffer.subarray(offset).toString("utf-8");
  if (tailText.length === 0) return;

  let changed = false;
  const rewrittenTail = tailText
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const entry = JSON.parse(line) as Record<string, unknown>;
      const message = entry.message as Record<string, unknown> | undefined;
      if (
        entry.type === "message" &&
        message?.role === "toolResult" &&
        typeof message.toolCallId === "string" &&
        summaries.has(message.toolCallId)
      ) {
        changed = true;
        return JSON.stringify({
          ...entry,
          message: {
            ...message,
            content: [{ type: "text", text: summaries.get(message.toolCallId)! }],
          },
        });
      }
      return line;
    })
    .join("\n");

  if (!changed) return;
  const tempFile = `${sessionFile}.${process.pid}.${Date.now()}.tmp`;

  try {
    writeFileSync(tempFile, prefixBuffer);
    appendFileSync(tempFile, `${rewrittenTail}\n`, "utf8");
    renameSync(tempFile, sessionFile);
  } finally {
    if (existsSync(tempFile)) {
      unlinkSync(tempFile);
    }
  }
}
