export function validateBuiltInOutput(agent: string, output: string): string | undefined {
  if (agent !== "planner") return;

  const headings = [
    "Objective",
    "Out of scope",
    "Assumptions",
    "Steps",
    "Risks & Mitigations",
    "Handoff Packet",
    "Open Questions",
  ];
  const optionalHeadings = ["Assumptions", "Open Questions"];
  const mainHeadings = [...output.matchAll(/^#\s+(.+?)\s*$/gm)];
  const firstLine = output.trimStart().split(/\r?\n/, 1)[0]?.trim();
  if (mainHeadings.length !== 1 || !firstLine || !new RegExp(`^# Plan:\\s+\\S`).test(firstLine)) {
    return "Plan output must start with '# Plan: [title]'.";
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
      return `Plan output has unexpected or out-of-order "## ${sectionHeading}".`;
    }
    headingIndex += 1;
  }

  for (; headingIndex < headings.length; headingIndex += 1) {
    if (!optionalHeadings.includes(headings[headingIndex]!)) {
      return `Plan output is missing "## ${headings[headingIndex]}".`;
    }
  }
}
