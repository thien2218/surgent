import {
  appendFileSync,
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

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

export function formatGrepResult(content: string): string {
  const formattedLines: string[] = [];
  const formattedIndexes = new Map<string, number>();
  let currentFilePath: string | undefined;
  let changed = false;

  for (const line of content.split("\n")) {
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
    changed = true;
  }

  return changed ? formattedLines.join("\n") : content;
}
