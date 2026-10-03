function validatePlannerOutput(output: string): string | undefined {
  const headings = [
    "Objective",
    "Out of scope",
    "Steps",
    "Risks & Mitigations",
    "Handoff Packet",
  ];
  if (!/^# Plan:[^\S\r\n]+\S/m.test(output)) {
    return "Plan output is missing '# Plan: [title]'.";
  }

  const sectionHeadings = [...output.matchAll(/^##\s+(.+?)\s*$/gm)].map((match) =>
    match[1]!.trim(),
  );
  for (const heading of headings) {
    if (!sectionHeadings.includes(heading)) {
      return `Plan output is missing "## ${heading}".`;
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
  const sectionHeadings = [...output.matchAll(/^##\s+(.+?)\s*$/gm)].map((match) =>
    match[1]!.trim(),
  );
  for (const heading of headings) {
    if (!sectionHeadings.includes(heading)) {
      return `Scout output is missing "## ${heading}".`;
    }
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
