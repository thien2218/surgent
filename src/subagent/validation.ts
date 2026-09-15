function validatePlannerOutput(output: string): string | undefined {
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
  if (mainHeadings.length !== 1 || !firstLine || !/^# Plan:\s+\S/.test(firstLine)) {
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

function validateScoutOutput(output: string, input: string): string | undefined {
  const depthMatch = input.match(/^Depth:\s*(quick|standard|deep)\s*$/im);
  const depth = depthMatch?.[1]?.toLowerCase() ?? "standard";
  const headings =
    depth === "quick"
      ? ["Answer", "Evidence", "Gaps"]
      : depth === "deep"
        ? [
            "Answer",
            "Execution flow",
            "Relevant locations",
            "Change impact",
            "Verification",
            "Evidence",
            "Gaps",
          ]
        : ["Answer", "Execution flow", "Relevant locations", "Evidence", "Gaps"];
  const firstLine = output.trimStart().split(/\r?\n/, 1)[0]?.trim();
  if (firstLine !== "## Answer") {
    return "Scout output must start with '## Answer'.";
  }

  const sections = [...output.matchAll(/^##\s+(.+?)\s*$/gm)];
  for (let headingIndex = 0; headingIndex < headings.length; headingIndex += 1) {
    const actualHeading = sections[headingIndex]?.[1]?.trim();
    if (!actualHeading) return `Scout output is missing "## ${headings[headingIndex]}".`;
    if (actualHeading !== headings[headingIndex]) {
      return `Scout output has unexpected or out-of-order "## ${actualHeading}".`;
    }
  }
  if (sections.length > headings.length) {
    return `Scout output has unexpected or out-of-order "## ${sections[headings.length]![1]!.trim()}".`;
  }

  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const contentStart = (sections[sectionIndex]!.index ?? 0) + sections[sectionIndex]![0].length;
    const contentEnd = sections[sectionIndex + 1]?.index ?? output.length;
    if (!output.slice(contentStart, contentEnd).trim()) {
      return `Scout output section "## ${sections[sectionIndex]![1]!.trim()}" cannot be empty.`;
    }
  }

  const evidenceIndex = headings.indexOf("Evidence");
  const evidenceStart = (sections[evidenceIndex]!.index ?? 0) + sections[evidenceIndex]![0].length;
  const evidenceEnd = sections[evidenceIndex + 1]?.index ?? output.length;
  if (!/^- `[^`\r\n]+` — `[^`\r\n]+`: \S+/m.test(output.slice(evidenceStart, evidenceEnd))) {
    return "Scout output must include evidence as '- `path:line` — `symbol`: finding'.";
  }
}

export function validateBuiltInOutput(
  agent: string,
  output: string,
  input: string,
): string | undefined {
  if (agent === "planner") return validatePlannerOutput(output);
  if (agent === "scout") return validateScoutOutput(output, input);
}
