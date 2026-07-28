import type { ToolResultEvent } from "@earendil-works/pi-coding-agent";

type BashToolResultEvent = Extract<ToolResultEvent, { toolName: "bash" }>;
type GrepToolResultEvent = Extract<ToolResultEvent, { toolName: "grep" }>;

function getTextContent(event: ToolResultEvent): string {
  const block = event.content.find((contentBlock) => contentBlock.type === "text");
  return block?.type === "text" ? block.text : "";
}

export function extractBashSummary(event: BashToolResultEvent): string | null {
  const commandInput = event.input.command;
  if (typeof commandInput !== "string") {
    return null;
  }

  const status = event.isError ? "error" : "ok";
  const truncation = event.details?.truncation;

  if (truncation?.truncated) {
    const startLine = truncation.totalLines - truncation.outputLines + 1;
    const endLine = truncation.totalLines;
    const partialLastLine = truncation.lastLinePartial === true ? "true" : "false";
    return `Bash command="${commandInput}" | status=${status} | output=tail:L${startLine}-L${endLine}/L${truncation.totalLines} | partialLastLine=${partialLastLine}`;
  }

  const contentText = getTextContent(event).trim();
  const outputState = !contentText || contentText === "(no output)" ? "none" : "present";
  return `Bash command="${commandInput}" | status=${status} | output=${outputState}`;
}

export function extractGrepSummary(event: GrepToolResultEvent): string | null {
  const contentText = getTextContent(event);
  if (contentText === "No matches found") return null;

  // Default no-context grep output: "<relPath>:<lineNum>: <text>"
  // Collect file → sorted line numbers.
  const fileLines = new Map<string, Set<number>>();
  const linePattern = /^(.+?):(\d+): /gm;
  let matched = false;

  for (const match of contentText.matchAll(linePattern)) {
    const filePath = match[1];
    const lineNumStr = match[2];
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

  return Array.from(fileLines.entries())
    .map(([filePath, lines]) => `${filePath} - Matched lines: ${Array.from(lines).join(", ")}`)
    .join("\n");
}
