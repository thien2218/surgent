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
