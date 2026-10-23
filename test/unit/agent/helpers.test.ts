import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCwdSection, getAgentConfigForm } from "../../../src/agent/helpers.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("agent restriction fields", () => {
  it("renders quoted arrays without splitting commas inside entries", () => {
    const form = getAgentConfigForm("probe", {
      description: "Probe",
      bash: ['printf "a,b"'],
      "files.read": ["src/a,b.ts"],
      "files.write": [],
      tools: ["read", "write"],
    }, false);

    expect(form.fields.find((field) => field.key === "bash")?.mode).toMatchObject({ text: JSON.stringify(['printf "a,b"']) });
    expect(form.fields.find((field) => field.key === "files.read")?.mode).toMatchObject({ text: '["src/a,b.ts"]' });
    expect(form.fields.find((field) => field.key === "files.write")?.mode).toMatchObject({ text: "[]" });
    expect(form.fields.find((field) => field.key === "tools")?.mode).toMatchObject({ text: "read, write" });
  });

  it("parses quoted commands and normalizes file paths on save", () => {
    const form = getAgentConfigForm("probe", { description: "Probe" }, false);

    expect(form.parseOnSave!({
      description: "Probe",
      bash: JSON.stringify(['printf "a,b"']),
      "files.read": JSON.stringify(["C:\\repo\\**"]),
    })).toEqual({ description: "Probe", bash: ['printf "a,b"'], "files.read": ["C:/repo/**"] });
  });

  it.each(["bash", "files.read", "files.write"])("rejects unquoted %s entries", (field) => {
    const form = getAgentConfigForm("probe", { description: "Probe" }, false);

    expect(() => form.parseOnSave!({ description: "Probe", [field]: "[src/**]" }))
      .toThrow("double-quoted strings");
  });

  it("keeps inheritance distinct from an explicit empty restriction", () => {
    const form = getAgentConfigForm("probe", { description: "Probe" }, false);

    expect(form.parseOnSave!({ description: "Probe", bash: "", "files.read": "[]" }))
      .toEqual({ description: "Probe", "files.read": [] });
  });
});

describe("cwd section", () => {
  it("lists the slash-normalized path, platform and local date", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 3, 3, 12));
    expect(buildCwdSection("C:\\work\\repo")).toBe(`C:/work/repo\nplatform: ${process.platform}\ndate: 2026-04-03`);
  });
});
