import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getPlanCompletions, getPlanPreviews, parseCommandInput } from "../../../src/commands/helpers.js";
import { commandWorkspace, PLAN_ID, planMetadata, storePlans } from "../../helpers/commands.js";

describe("command input", () => {
  it.each(["", "  \t\n"])("lists plans for empty input %j", (input) => {
    expect(parseCommandInput(input)).toEqual({ kind: "list" });
  });

  it("resumes a whitespace-padded UUIDv7", () => {
    expect(parseCommandInput(` \n${PLAN_ID}\t `)).toEqual({ kind: "resume", subsessionId: PLAN_ID });
  });

  it.each(["implement caching", "01900000-0000-4000-8000-000000000001", "not-a-uuid", `${PLAN_ID} details`])(
    "treats non-resume input %j as a trimmed prompt",
    (input) => {
      expect(parseCommandInput(`  ${input}\n`)).toEqual({ kind: "prompt", prompt: input });
    },
  );
});

describe("saved plan lookup", () => {
  it("returns no plans when storage does not exist", async () => {
    const cwd = await commandWorkspace();
    expect(await getPlanPreviews(cwd, "parent-session")).toEqual([]);
    expect(await getPlanCompletions(cwd, "parent-session", "")).toBeNull();
  });

  it("exposes only plan IDs and titles belonging to the current parent", async () => {
    const cwd = await commandWorkspace();
    await storePlans(cwd, {
      [PLAN_ID]: planMetadata("Cache strategy"),
      foreign: planMetadata("Other session", "other-parent"),
      documenter: { ...planMetadata("Documentation"), label: "subagent" },
    });

    expect(await getPlanPreviews(cwd, "parent-session")).toEqual([
      { subsessionId: PLAN_ID, title: "Cache strategy" },
    ]);
  });

  it.each(["", "  ", "01900000", "CACHE", " strategy "])("completes matching prefix %j", async (prefix) => {
    const cwd = await commandWorkspace();
    await storePlans(cwd, { [PLAN_ID]: planMetadata("Cache strategy") });

    expect(await getPlanCompletions(cwd, "parent-session", prefix)).toEqual([
      { value: PLAN_ID, label: "Cache strategy" },
    ]);
  });

  it("returns null when neither ID prefix nor title matches", async () => {
    const cwd = await commandWorkspace();
    await storePlans(cwd, { [PLAN_ID]: planMetadata("Cache strategy") });

    expect(await getPlanCompletions(cwd, "parent-session", "missing")).toBeNull();
    expect(await getPlanCompletions(cwd, "parent-session", PLAN_ID.slice(-8))).toBeNull();
  });

  it.each(["{broken", "[]", "null"])("surfaces invalid storage %j", async (content) => {
    const cwd = await commandWorkspace();
    await writeFile(join(cwd, ".pi", "subsessions.json"), content);

    await expect(getPlanPreviews(cwd, "parent-session")).rejects.toBeInstanceOf(Error);
  });

  it("does not disguise storage read failures as an empty list", async () => {
    const cwd = await commandWorkspace();
    await mkdir(join(cwd, ".pi", "subsessions.json"));

    await expect(getPlanPreviews(cwd, "parent-session")).rejects.toBeInstanceOf(Error);
  });
});
