export function formatWebFetchSummary(content: string): string {
  const lines = content.split("\n");
  const headings: Array<{ endLine?: number; level: number; line: number; title: string }> = [];
  let fenceMarker: string | undefined;

  for (const [index, line] of lines.entries()) {
    const fenceMatch = line.match(/^(```+|~~~+)/);
    if (fenceMatch) {
      const marker = fenceMatch[1]!;
      if (!fenceMarker) {
        fenceMarker = marker[0]!.repeat(marker.length);
      } else if (line.startsWith(fenceMarker)) {
        fenceMarker = undefined;
      }
      continue;
    }

    if (fenceMarker) {
      continue;
    }

    const headingMatch = line.match(/^(#{1,5})[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/);
    if (!headingMatch) {
      continue;
    }

    headings.push({
      level: headingMatch[1]!.length,
      line: index + 1,
      title: headingMatch[2]!.trim(),
    });
  }

  if (headings.length === 0) {
    return "";
  }

  for (const [index, heading] of headings.entries()) {
    const nextSiblingOrAncestor = headings
      .slice(index + 1)
      .find((candidate) => candidate.level <= heading.level);
    heading.endLine = nextSiblingOrAncestor ? nextSiblingOrAncestor.line - 1 : lines.length;
  }

  return headings
    .map((heading) => {
      const indent = "  ".repeat(heading.level - 1);
      return `${indent}${"#".repeat(heading.level)} ${heading.title} (L${heading.line}-${heading.endLine})`;
    })
    .join("\n");
}
