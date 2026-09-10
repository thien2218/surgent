export function validateBuiltInOutput(agent: string, output: string): string | undefined {
  switch (agent) {
    case "planner":
      return validateMarkdownHeadings(
        output,
        "Plan",
        [
          "Objective",
          "Out of scope",
          "Assumptions",
          "Steps",
          "Risks & Mitigations",
          "Handoff Packet",
          "Open Questions",
        ],
        ["Assumptions", "Open Questions"],
      );
    case "reviewer": {
      const headingError = validateMarkdownHeadings(
        output,
        "Review",
        ["Verdict", "Findings", "Missing context", "Checks performed"],
        ["Missing context"],
      );
      if (headingError) return headingError;

      const verdict = output
        .match(/^##\s+Verdict\s*\r?\n([\s\S]*?)^##\s+Findings\s*$/m)?.[1]
        ?.trim()
        .split(/\r?\n/, 1)[0]
        ?.replace(/^`|`$/g, "")
        .trim();
      if (!verdict || !["APPROVE", "REQUEST_CHANGES", "NEEDS_INFO"].includes(verdict)) {
        return "Review output has an invalid verdict.";
      }
    }
  }
}

function validateMarkdownHeadings(
  output: string,
  title: string,
  headings: string[],
  optionalHeadings: string[],
): string | undefined {
  const mainHeadings = [...output.matchAll(/^#\s+(.+?)\s*$/gm)];
  const firstLine = output.trimStart().split(/\r?\n/, 1)[0]?.trim();
  if (
    mainHeadings.length !== 1 ||
    !firstLine ||
    !new RegExp(`^# ${title}:\\s+\\S`).test(firstLine)
  ) {
    return `${title} output must start with "# ${title}: [title]".`;
  }

  const sectionHeadings = [...output.matchAll(/^##\s+(.+?)\s*$/gm)].map((match) =>
    match[1]!.trim(),
  );
  let headingIndex = 0;
  for (const sectionHeading of sectionHeadings) {
    while (
      headingIndex < headings.length &&
      headings[headingIndex] !== sectionHeading &&
      optionalHeadings.includes(headings[headingIndex]!)
    ) {
      headingIndex += 1;
    }
    if (headings[headingIndex] !== sectionHeading) {
      return `${title} output has unexpected or out-of-order "## ${sectionHeading}".`;
    }
    headingIndex += 1;
  }

  for (; headingIndex < headings.length; headingIndex += 1) {
    if (!optionalHeadings.includes(headings[headingIndex]!)) {
      return `${title} output is missing "## ${headings[headingIndex]}".`;
    }
  }
}
