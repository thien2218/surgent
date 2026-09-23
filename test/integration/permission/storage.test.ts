import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makePermissionWorkspace, type PermissionWorkspace } from "../../helpers/permission.js";
import { addRules, getRulesForDisplay, persistRules, readRules, removeRule, toggleRule, writeRules } from "../../../src/permission/storage.js";

let workspace: PermissionWorkspace;

beforeEach(async () => {
  workspace = await makePermissionWorkspace("surgent-rule-storage-");
});

afterEach(async () => {
  await workspace.restore();
});

describe("permission rule storage", () => {
  it("treats missing files as empty rules and display groups", async () => {
    await expect(readRules()).resolves.toEqual({});
    await expect(readRules(workspace.cwd)).resolves.toEqual({});
    await expect(getRulesForDisplay(workspace.cwd, "session-1")).resolves.toEqual({
      file: [], bash: [], web: [], mcp: [],
    });
  });

  it.each(["session", "project", "global"] as const)("removes only the selected %s rule", async (scope) => {
    await writeRules({ web: { target: true, keep: false } });
    await writeRules({
      "session-1": { web: { target: true, keep: false } },
      project: { web: { target: true, keep: false } },
      "session-2": { web: { target: true } },
    }, workspace.cwd);

    await removeRule(workspace.cwd, "session-1", scope, "web", "target");
    await removeRule(workspace.cwd, "session-1", scope, "web", "absent");

    await expect(readRules()).resolves.toEqual({
      web: scope === "global" ? { keep: false } : { target: true, keep: false },
    });
    await expect(readRules(workspace.cwd)).resolves.toEqual({
      "session-1": { web: scope === "session" ? { keep: false } : { target: true, keep: false } },
      project: { web: scope === "project" ? { keep: false } : { target: true, keep: false } },
      "session-2": { web: { target: true } },
    });
  });

  it("initializes a missing file rule and cycles through write, read, deny, and write", async () => {
    for (const value of ["write", "read", "deny", "write"]) {
      await toggleRule(workspace.cwd, "session-1", "session", "file", "target");
      await expect(readRules(workspace.cwd)).resolves.toEqual({ "session-1": { file: { target: value } } });
    }
  });

  it.each(["web", "bash", "mcp"] as const)("initializes and toggles boolean %s rules", async (category) => {
    for (const value of [true, false, true]) {
      await toggleRule(workspace.cwd, "session-1", "global", category, "target");
      await expect(readRules()).resolves.toEqual({ [category]: { target: value } });
    }
    await expect(readRules(workspace.cwd)).resolves.toEqual({});
  });

  it("cleans temporary writes and preserves the destination when replacement fails", async () => {
    await mkdir(join(workspace.cwd, ".pi", "permissions.json"));
    await writeFile(join(workspace.cwd, ".pi", "permissions.json", "keep.txt"), "preserve");

    await expect(writeRules({ project: { web: { target: true } } }, workspace.cwd)).rejects.toThrow();

    await expect(readFile(join(workspace.cwd, ".pi", "permissions.json", "keep.txt"), "utf8"))
      .resolves.toBe("preserve");
    await expect(readdir(join(workspace.cwd, ".pi"))).resolves.toEqual(["permissions.json"]);
  });

  it("does not treat an unreadable rules path as missing configuration", async () => {
    await mkdir(join(workspace.cwd, ".pi", "permissions.json"));

    await expect(readRules(workspace.cwd)).rejects.toMatchObject({ code: "EISDIR" });
  });

  it.each([
    { file: { "src/a.ts": true } },
    { web: { "https://example.test": "allow" } },
    { web: [] },
    { unknown: {} },
  ])("rejects malformed global schema %j", async (schema) => {
    await writeFile(join(workspace.home, ".pi", "agent", "permissions.json"), JSON.stringify(schema));

    await expect(readRules()).rejects.toThrow("Invalid permission rules");
  });

  it.each([
    { project: { file: { "src/a.ts": true } } },
    { "session-1": { web: { "https://example.test": "allow" } } },
    { project: { web: [] } },
    { "session-1": { unknown: {} } },
  ])("rejects malformed local schema %j", async (schema) => {
    await writeFile(join(workspace.cwd, ".pi", "permissions.json"), JSON.stringify(schema));

    await expect(readRules(workspace.cwd)).rejects.toThrow("Invalid permission rules");
  });

  it.each(["session", "project", "global"] as const)("adding %s rules preserves all other entries", async (scope) => {
    const global = { file: { "docs/a.md": "read" as const }, web: { "https://kept.test": false } };
    const local = {
      "session-1": { file: { "src/a.ts": "read" as const }, web: { "https://kept.test": false } },
      project: { mcp: { "docs:search": false }, web: { "https://kept.test": false } },
      "session-2": { bash: { "git status": true } },
    };
    await writeRules(global);
    await writeRules(local, workspace.cwd);

    await addRules(workspace.cwd, "session-1", scope, "web", new Map([["https://added.test", true]]));

    if (scope === "global") {
      await expect(readRules()).resolves.toEqual({
        ...global, web: { "https://kept.test": false, "https://added.test": true },
      });
      await expect(readRules(workspace.cwd)).resolves.toEqual(local);
    } else {
      const key = scope === "session" ? "session-1" : "project";
      await expect(readRules(workspace.cwd)).resolves.toEqual({
        ...local,
        [key]: { ...local[key], web: { "https://kept.test": false, "https://added.test": true } },
      });
      await expect(readRules()).resolves.toEqual(global);
    }
  });

  it("saves edited scopes without retaining removed rules or changing other sessions", async () => {
    await writeRules({ bash: { "obsolete *": true } });
    await writeRules({
      "session-1": { bash: { "obsolete *": true } },
      project: { bash: { "obsolete *": true } },
      "session-2": { file: { "keep.txt": "read" } },
    }, workspace.cwd);
    const rules = {
      session: { file: { "same.txt": "write" as const }, bash: { "git status": false } },
      project: { file: { "same.txt": "read" as const }, web: { "https://project.test": true } },
      global: { file: { "same.txt": "deny" as const }, mcp: { "docs:search": true } },
    };

    await persistRules(workspace.cwd, "session-1", rules);

    await expect(readRules(workspace.cwd)).resolves.toEqual({
      "session-1": rules.session,
      project: rules.project,
      "session-2": { file: { "keep.txt": "read" } },
    });
    await expect(readRules()).resolves.toEqual(rules.global);
  });

  it("displays identical patterns separately by scope and hides other sessions", async () => {
    await writeRules({ file: { "same.txt": "deny" }, mcp: { "docs:search": true } });
    await writeRules({
      "session-1": { file: { "same.txt": "write" }, bash: { "git status": false } },
      project: { file: { "same.txt": "read" }, web: { "https://project.test": true } },
      "session-2": { file: { "keep.txt": "read" } },
    }, workspace.cwd);

    await expect(getRulesForDisplay(workspace.cwd, "session-1")).resolves.toEqual({
      file: [
        { pattern: "same.txt", value: "write", scope: "session", category: "file" },
        { pattern: "same.txt", value: "read", scope: "project", category: "file" },
        { pattern: "same.txt", value: "deny", scope: "global", category: "file" },
      ],
      bash: [{ pattern: "git status", value: false, scope: "session", category: "bash" }],
      web: [{ pattern: "https://project.test", value: true, scope: "project", category: "web" }],
      mcp: [{ pattern: "docs:search", value: true, scope: "global", category: "mcp" }],
    });
  });
});
