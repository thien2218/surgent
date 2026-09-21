import * as fsPromises from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addRules,
  readRules,
  removeRule,
  toggleRule,
  writeRules,
} from "../../../src/permission/storage.js";
import { getPiPath } from "../../../src/utils.js";
import { createPermissionSandbox } from "../../helpers/permission.js";

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return { ...actual, rename: vi.fn(actual.rename) };
});

let sandbox: Awaited<ReturnType<typeof createPermissionSandbox>>;

beforeEach(async () => {
  sandbox = await createPermissionSandbox();
});

afterEach(async () => {
  await sandbox.cleanup();
});

describe("permission storage", () => {
  it("isolates session, project, and global rules", async () => {
    await addRules(sandbox.cwd, "session-1", "session", "file", new Map([["one/**", "read"]]));
    await addRules(sandbox.cwd, "session-2", "session", "web", new Map([["https://two/**", true]]));
    await addRules(sandbox.cwd, "session-1", "project", "bash", new Map([["git *", false]]));
    await addRules(sandbox.cwd, "session-1", "always", "mcp", new Map([["github:*", true]]));

    const local = await readRules(sandbox.cwd);
    const global = await readRules();

    expect(local).toEqual({
      "session-1": { file: { "one/**": "read" } },
      "session-2": { web: { "https://two/**": true } },
      project: { bash: { "git *": false } },
    });
    expect(global).toEqual({ mcp: { "github:*": true } });
  });

  it("adds, overwrites, removes, and toggles rules without changing neighbors", async () => {
    await addRules(
      sandbox.cwd,
      "session-1",
      "session",
      "file",
      new Map([
        ["src/**", "read"],
        ["docs/**", "write"],
      ]),
    );
    await addRules(
      sandbox.cwd,
      "session-1",
      "session",
      "file",
      new Map([["src/**", "write"]]),
    );
    await toggleRule(sandbox.cwd, "session-1", "session", "file", "src/**");
    await addRules(sandbox.cwd, "session-1", "session", "bash", new Map([["git *", true]]));
    await toggleRule(sandbox.cwd, "session-1", "session", "bash", "git *");
    await removeRule(sandbox.cwd, "session-1", "session", "file", "docs/**");

    expect(await readRules(sandbox.cwd)).toEqual({
      "session-1": {
        file: { "src/**": "read" },
        bash: { "git *": false },
      },
    });
  });

  it("treats missing files as empty configuration", async () => {
    expect(await readRules(sandbox.cwd)).toEqual({});
    expect(await readRules()).toEqual({});
  });

  it.each([
    ["invalid JSON", "{"],
    ["invalid schema", JSON.stringify({ session: { file: { "src/**": "execute" } } })],
  ])("rejects %s instead of granting empty permissions", async (_label, contents) => {
    await fsPromises.writeFile(getPiPath("permissions", sandbox.cwd), contents, "utf8");

    await expect(readRules(sandbox.cwd)).rejects.toThrow();
  });

  it("rejects unreadable permission paths", async () => {
    const filePath = getPiPath("permissions", sandbox.cwd);
    await fsPromises.mkdir(filePath);

    await expect(readRules(sandbox.cwd)).rejects.toThrow();
  });

  it("preserves existing data when atomic replacement fails", async () => {
    await writeRules({ project: { file: { "src/**": "read" } } }, sandbox.cwd);
    const filePath = getPiPath("permissions", sandbox.cwd);
    const original = await fsPromises.readFile(filePath, "utf8");
    vi.mocked(fsPromises.rename).mockRejectedValueOnce(new Error("replace failed"));

    await expect(
      writeRules({ project: { file: { "src/**": "blocked" } } }, sandbox.cwd),
    ).rejects.toThrow("replace failed");

    expect(await fsPromises.readFile(filePath, "utf8")).toBe(original);
    expect((await fsPromises.readdir(join(sandbox.cwd, ".pi"))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});
