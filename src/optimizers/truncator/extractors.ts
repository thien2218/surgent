import type { ToolResultEvent } from "@earendil-works/pi-coding-agent";

type BashToolResultEvent = Extract<ToolResultEvent, { toolName: "bash" }>;
type ReadToolResultEvent = Extract<ToolResultEvent, { toolName: "read" }>;
type GrepToolResultEvent = Extract<ToolResultEvent, { toolName: "grep" }>;

const READ_CONTINUATION_NOTICE = /\n\n\[\d+ more lines in file\. Use offset=\d+ to continue\.\]$/;

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

export function extractReadSummary(event: ReadToolResultEvent): string | null {
  const path = event.input.path;
  if (typeof path !== "string" || !path || event.isError) {
    return null;
  }

  if (event.content.some((contentBlock) => contentBlock.type === "image")) {
    return null;
  }

  const startLine = typeof event.input.offset === "number" ? event.input.offset : 1;
  const truncation = event.details?.truncation;
  if (truncation?.firstLineExceedsLimit) {
    return `${path} ${startLine}-${startLine}`;
  }
  if (truncation?.truncated) {
    const endLine = startLine + truncation.outputLines - 1;
    return `${path} ${startLine}-${endLine}`;
  }

  const contentText = getTextContent(event);
  if (!contentText || contentText.startsWith("Read image file [")) {
    return null;
  }

  const contentWithoutNotice = contentText.replace(READ_CONTINUATION_NOTICE, "");
  if (!contentWithoutNotice) {
    return null;
  }

  const lineCount = contentWithoutNotice.split("\n").length;
  const endLine = startLine + lineCount - 1;
  return `Read ${path} L${startLine}-L${endLine}`;
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
    .map(([filePath, lines]) => `${filePath} - Matched lines: ${Array.from(lines).join(",")}`)
    .join("\n");
}
