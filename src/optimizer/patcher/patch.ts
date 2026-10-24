import type { Comparator, Hunk, Replacement, UpdateChunk } from "./types.js";

const BEGIN_MARKER = "*** Begin Patch";
const END_MARKER = "*** End Patch";
const ADD_HEADER = "*** Add File:";
const DELETE_HEADER = "*** Delete File:";
const UPDATE_HEADER = "*** Update File:";
const MOVE_HEADER = "*** Move to:";
const EOF_MARKER = "*** End of File";
const BOM = "﻿";

function parsePatchHeader(
  lines: string[],
  startIdx: number,
): { filePath: string; movePath?: string; nextIdx: number } | null {
  const line = lines[startIdx]!;

  if (line.startsWith(ADD_HEADER)) {
    const filePath = line.slice(ADD_HEADER.length).trim();
    return filePath ? { filePath, nextIdx: startIdx + 1 } : null;
  }

  if (line.startsWith(DELETE_HEADER)) {
    const filePath = line.slice(DELETE_HEADER.length).trim();
    return filePath ? { filePath, nextIdx: startIdx + 1 } : null;
  }

  if (line.startsWith(UPDATE_HEADER)) {
    const filePath = line.slice(UPDATE_HEADER.length).trim();
    let movePath: string | undefined;
    let nextIdx = startIdx + 1;

    if (nextIdx < lines.length && lines[nextIdx]!.startsWith(MOVE_HEADER)) {
      movePath = lines[nextIdx]!.slice(MOVE_HEADER.length).trim();
      nextIdx++;
    }

    return filePath ? { filePath, movePath, nextIdx } : null;
  }

  return null;
}

function parseUpdateChunks(
  lines: string[],
  startIdx: number,
): { chunks: UpdateChunk[]; nextIdx: number } {
  const chunks: UpdateChunk[] = [];
  let lineIdx = startIdx;

  while (lineIdx < lines.length && !lines[lineIdx]!.startsWith("***")) {
    if (!lines[lineIdx]!.startsWith("@@")) {
      lineIdx++;
      continue;
    }

    const contextLine = lines[lineIdx]!.substring(2).trim();
    lineIdx++;

    const oldLines: string[] = [];
    const newLines: string[] = [];
    let isEndOfFile = false;

    while (lineIdx < lines.length && !lines[lineIdx]!.startsWith("@@")) {
      const changeLine = lines[lineIdx]!;

      // Checked before the "***" stop below, which would otherwise swallow the marker.
      if (changeLine === EOF_MARKER) {
        isEndOfFile = true;
        lineIdx++;
        break;
      }
      if (changeLine.startsWith("***")) break;

      if (changeLine.startsWith(" ")) {
        const content = changeLine.substring(1);
        oldLines.push(content);
        newLines.push(content);
      } else if (changeLine.startsWith("-")) {
        oldLines.push(changeLine.substring(1));
      } else if (changeLine.startsWith("+")) {
        newLines.push(changeLine.substring(1));
      }

      lineIdx++;
    }

    chunks.push({
      oldLines,
      newLines,
      changeContext: contextLine || undefined,
      isEndOfFile: isEndOfFile || undefined,
    });
  }

  return { chunks, nextIdx: lineIdx };
}

function parseAddContent(lines: string[], startIdx: number): { content: string; nextIdx: number } {
  let content = "";
  let lineIdx = startIdx;

  while (lineIdx < lines.length && !lines[lineIdx]!.startsWith("***")) {
    if (lines[lineIdx]!.startsWith("+")) {
      content += lines[lineIdx]!.substring(1) + "\n";
    }
    lineIdx++;
  }

  if (content.endsWith("\n")) {
    content = content.slice(0, -1);
  }

  return { content, nextIdx: lineIdx };
}

function stripHeredoc(input: string): string {
  // Match heredoc patterns like: cat <<'EOF'\n...\nEOF or <<EOF\n...\nEOF
  const heredocMatch = input.match(/^(?:cat\s+)?<<['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\1\s*$/);
  return heredocMatch ? heredocMatch[2]! : input;
}

function computeReplacements(
  originalLines: string[],
  filePath: string,
  chunks: UpdateChunk[],
): Replacement[] {
  const replacements: Replacement[] = [];
  let lineIdx = 0;

  for (const chunk of chunks) {
    if (chunk.changeContext) {
      const contextIdx = seekSequence(originalLines, [chunk.changeContext], lineIdx);
      if (contextIdx === -1) {
        throw new Error(`Failed to find context '${chunk.changeContext}' in ${filePath}`);
      }
      lineIdx = contextIdx + 1;
    }
    // Pure addition: append at end of file
    if (chunk.oldLines.length === 0) {
      const insertionIdx =
        originalLines.length > 0 && originalLines[originalLines.length - 1] === ""
          ? originalLines.length - 1
          : originalLines.length;
      replacements.push([insertionIdx, 0, chunk.newLines]);
      continue;
    }

    let pattern = chunk.oldLines;
    let newSlice = chunk.newLines;
    let found = seekSequence(originalLines, pattern, lineIdx, chunk.isEndOfFile);

    // Retry without trailing empty line if not found
    if (found === -1 && pattern.length > 0 && pattern[pattern.length - 1] === "") {
      pattern = pattern.slice(0, -1);
      if (newSlice.length > 0 && newSlice[newSlice.length - 1] === "") {
        newSlice = newSlice.slice(0, -1);
      }
      found = seekSequence(originalLines, pattern, lineIdx, chunk.isEndOfFile);
    }

    if (found === -1) {
      throw new Error(
        `Failed to find expected lines in ${filePath}:\n${chunk.oldLines.join("\n")}`,
      );
    }
    replacements.push([found, pattern.length, newSlice]);
    lineIdx = found + pattern.length;
  }

  replacements.sort((left, right) => left[0] - right[0]);
  return replacements;
}

function applyReplacements(lines: string[], replacements: Replacement[]): string[] {
  const result = [...lines];
  // Apply in reverse order to avoid index shifting
  for (const [startIdx, oldLength, newSegment] of replacements.toReversed()) {
    result.splice(startIdx, oldLength, ...newSegment);
  }
  return result;
}

// Normalize Unicode punctuation to ASCII equivalents (like Rust's normalize_unicode)
function normalizeUnicode(text: string): string {
  return text
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ");
}

function matchesAt(lines: string[], pattern: string[], startIdx: number, compare: Comparator) {
  return pattern.every((expected, offset) => compare(lines[startIdx + offset]!, expected));
}

function tryMatch(
  lines: string[],
  pattern: string[],
  startIdx: number,
  compare: Comparator,
  eof: boolean,
): number {
  if (eof) {
    const fromEnd = lines.length - pattern.length;
    // Try matching from end of file first
    if (fromEnd >= startIdx && matchesAt(lines, pattern, fromEnd, compare)) return fromEnd;
  }

  for (let lineIdx = startIdx; lineIdx <= lines.length - pattern.length; lineIdx++) {
    if (matchesAt(lines, pattern, lineIdx, compare)) return lineIdx;
  }

  return -1;
}

function seekSequence(lines: string[], pattern: string[], startIdx: number, eof = false): number {
  if (pattern.length === 0) return -1;

  const comparators: Comparator[] = [
    (actual, expected) => actual === expected,
    (actual, expected) => actual.trimEnd() === expected.trimEnd(),
    (actual, expected) => actual.trim() === expected.trim(),
    (actual, expected) => normalizeUnicode(actual.trim()) === normalizeUnicode(expected.trim()),
  ];
  for (const compare of comparators) {
    const found = tryMatch(lines, pattern, startIdx, compare, eof);
    if (found !== -1) return found;
  }
  return -1;
}

export function splitBom(text: string) {
  return text.startsWith(BOM) ? { bom: true, text: text.slice(1) } : { bom: false, text };
}

export function joinBom(text: string, bom: boolean) {
  return bom ? BOM + text : text;
}

// Same line-ending rules as pi's edit tool: match on LF, write back the file's first ending.
export function detectLineEnding(text: string) {
  const crlfIdx = text.indexOf("\r\n");
  const lfIdx = text.indexOf("\n");
  return crlfIdx !== -1 && crlfIdx < lfIdx ? "\r\n" : "\n";
}

export function normalizeToLF(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function restoreLineEndings(text: string, ending: string) {
  return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

export function parsePatch(patchText: string): Hunk[] {
  const lines = stripHeredoc(normalizeToLF(patchText).trim()).split("\n");
  const hunks: Hunk[] = [];

  const beginIdx = lines.findIndex((line) => line.trim() === BEGIN_MARKER);
  const endIdx = lines.findIndex((line) => line.trim() === END_MARKER);

  if (beginIdx === -1 || endIdx === -1 || beginIdx >= endIdx) {
    throw new Error("Invalid patch format: missing Begin/End markers");
  }

  let lineIdx = beginIdx + 1;
  while (lineIdx < endIdx) {
    const header = parsePatchHeader(lines, lineIdx);
    if (!header) {
      lineIdx++;
      continue;
    }

    const line = lines[lineIdx]!;
    if (line.startsWith(ADD_HEADER)) {
      const { content, nextIdx } = parseAddContent(lines, header.nextIdx);
      hunks.push({ type: "add", path: header.filePath, contents: content });
      lineIdx = nextIdx;
    } else if (line.startsWith(DELETE_HEADER)) {
      hunks.push({ type: "delete", path: header.filePath });
      lineIdx = header.nextIdx;
    } else {
      const { chunks, nextIdx } = parseUpdateChunks(lines, header.nextIdx);
      hunks.push({ type: "update", path: header.filePath, movePath: header.movePath, chunks });
      lineIdx = nextIdx;
    }
  }

  return hunks;
}

export function deriveNewContent(filePath: string, chunks: UpdateChunk[], originalText: string) {
  const originalLines = originalText.split("\n");
  // Drop trailing empty element for consistent line counting
  if (originalLines.length > 0 && originalLines[originalLines.length - 1] === "") {
    originalLines.pop();
  }

  const replacements = computeReplacements(originalLines, filePath, chunks);
  const newLines = applyReplacements(originalLines, replacements);

  if (newLines.length === 0 || newLines[newLines.length - 1] !== "") {
    newLines.push("");
  }

  return newLines.join("\n");
}
