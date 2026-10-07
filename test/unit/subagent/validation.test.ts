import { describe, expect, it } from "vitest";
import { validateBuiltInOutput } from "../../../src/subagent/validation.js";

const planSections = ["Objective", "Out of scope", "Steps", "Risks & Mitigations", "Handoff Packet"];
const scoutSections = {
  quick: ["Answer", "Evidence", "Gaps"],
  standard: ["Answer", "Execution flow", "Relevant locations", "Evidence", "Gaps"],
  deep: ["Answer", "Execution flow", "Relevant locations", "Change impact", "Verification", "Evidence", "Gaps"],
};
const sections = (headings: string[]) => headings.map((heading) => `## ${heading}\nContent`).join("\n");

describe("built-in output contracts", () => {
  it("accepts a titled plan with every required section", () => {
    expect(validateBuiltInOutput("planner", `# Plan: Work\n${sections(planSections)}`, "task")).toBeUndefined();
  });

  it.each(["", "# Plan:", "# Plan:   ", "# Plan:\n", "## Plan: Work", "# plan: Work"])(
    "rejects missing or malformed plan title %j", (title) => {
      expect(validateBuiltInOutput("planner", `${title}\n${sections(planSections)}`, "task")).toContain("# Plan:");
    },
  );

  it.each(planSections)("rejects a plan missing %s", (missing) => {
    const output = `# Plan: Work\n${sections(planSections.filter((heading) => heading !== missing))}`;
    expect(validateBuiltInOutput("planner", output, "task")).toContain(`## ${missing}`);
  });

  for (const depth of ["quick", "standard", "deep"] as const) {
    it(`accepts ${depth} scout output`, () => {
      expect(validateBuiltInOutput("scout", sections(scoutSections[depth]), `Depth: ${depth}\nTask`)).toBeUndefined();
    });
    it.each(scoutSections[depth])(`rejects ${depth} scout output missing %s`, (missing) => {
      expect(validateBuiltInOutput("scout", sections(scoutSections[depth].filter((heading) => heading !== missing)), `Depth: ${depth}`))
        .toContain(`## ${missing}`);
    });
  }

  it.each(["Task", "Depth: unknown", "Use Depth: quick please"])("defaults to standard depth for %j", (input) => {
    expect(validateBuiltInOutput("scout", sections(scoutSections.quick), input)).toContain("Execution flow");
    expect(validateBuiltInOutput("scout", sections(scoutSections.standard), input)).toBeUndefined();
  });

  it("recognizes a case-insensitive depth line inside the task", () => {
    expect(validateBuiltInOutput("scout", sections(scoutSections.quick), "Task\ndEpTh: QUICK\nMore context")).toBeUndefined();
  });

  it.each(["### Answer", "## answer"])("does not accept wrong heading level or case: %s", (heading) => {
    expect(validateBuiltInOutput("scout", `${heading}\n## Evidence\n## Gaps`, "Depth: quick")).toContain("## Answer");
  });

  it("allows whitespace around headings and additional sections", () => {
    expect(validateBuiltInOutput("scout", "##   Answer  \n## Extra\n## Evidence\n## Gaps\t", "Depth: quick")).toBeUndefined();
  });

  it.each(["worker", "reviewer", "documenter"])("does not impose planner or scout headings on %s", (agent) => {
    expect(validateBuiltInOutput(agent, "", "task")).toBeUndefined();
  });
});
