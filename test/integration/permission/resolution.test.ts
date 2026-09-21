import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolvePermission } from "../../../src/permission/resolution.js";
import { writeRules } from "../../../src/permission/storage.js";
import { getPiPath } from "../../../src/utils.js";
import { createPermissionCheck, createPermissionSandbox } from "../../helpers/permission.js";

let sandbox: Awaited<ReturnType<typeof createPermissionSandbox>>;

beforeEach(async () => {
  sandbox = await createPermissionSandbox();
  await writeFile(
    getPiPath("subsessions", sandbox.cwd),
    JSON.stringify({ child: { pid: "parent" } }),
    "utf8",
  );
});

afterEach(async () => {
  await sandbox.cleanup();
});

function webCheck(unresolved = ["https://example.test/data"]) {
  return createPermissionCheck({
    sessionId: "child",
    toolName: "web_fetch",
    category: "web",
    raw: unresolved[0],
    unresolved,
  });
}

describe("persisted permission resolution", () => {
  it("clears unresolved commands when every command is allowed", async () => {
    await writeRules({ project: { bash: { "git commit *": true } } }, sandbox.cwd);
    const check = createPermissionCheck({
      toolName: "bash",
      category: "bash",
      raw: 'git commit -m "test"',
      unresolved: ['git commit -m "test"'],
    });

    expect(await resolvePermission(sandbox.cwd, check, "assistant")).toBe("allowed");
    expect(check.unresolved).toEqual([]);
    expect(check.raw).toBe('git commit -m "test"');
  });

  it.each(["assistant", "restricted"] as const)(
    "returns only unresolved commands under %s mode",
    async (mode) => {
      await writeRules({
        bash: { "git status *": true },
      });
      await writeRules({
        child: { bash: { "git diff *": true } },
        parent: { bash: { "git log *": true } },
        project: { bash: { "git commit *": true } },
      }, sandbox.cwd);
      const check = createPermissionCheck({
        sessionId: "child",
        toolName: "bash",
        category: "bash",
        unresolved: ["git add .", "git diff --stat", "git log -1", 'git commit -m "test"', "git status --short"],
      });

      expect(await resolvePermission(sandbox.cwd, check, mode)).toBe("ask");
      expect(check.unresolved).toEqual(
        mode === "restricted" ? ["git add .", "git status --short"] : ["git add ."],
      );
    },
  );

  it.each([
    ["git add .", "git commit -m test"],
    ["git commit -m test", "git add ."],
  ])("blocks compound requests with denied commands in either order", async (...unresolved) => {
    await writeRules({ project: { bash: { "git commit *": false } } }, sandbox.cwd);
    const check = createPermissionCheck({
      toolName: "bash",
      category: "bash",
      unresolved,
    });

    expect(await resolvePermission(sandbox.cwd, check, "assistant")).toBe("blocked");
    expect(check.unresolved).toEqual(unresolved);
  });

  it.each([
    [
      "session",
      { child: { web: { "https://example.test/data": true } }, parent: { web: { "*": false } } },
      { web: { "*": false } },
      "allowed",
    ],
    [
      "parent",
      { parent: { web: { "https://example.test/data": true } }, project: { web: { "*": false } } },
      { web: { "*": false } },
      "allowed",
    ],
    [
      "project",
      { project: { web: { "https://example.test/data": true } } },
      { web: { "*": false } },
      "allowed",
    ],
    ["global", {}, { web: { "https://example.test/data": true } }, "allowed"],
  ] as const)("uses %s before lower-precedence scopes", async (_scope, local, global, expected) => {
    await writeRules(local, sandbox.cwd);
    await writeRules(global);

    expect(await resolvePermission(sandbox.cwd, webCheck(), "assistant")).toBe(expected);
  });

  it("ignores global grants but retains global denials in restricted mode", async () => {
    await writeRules({ web: { "https://allowed.test/**": true, "https://blocked.test/**": false } });

    expect(
      await resolvePermission(sandbox.cwd, webCheck(["https://allowed.test/data"]), "restricted"),
    ).toBe("ask");
    expect(
      await resolvePermission(sandbox.cwd, webCheck(["https://blocked.test/data"]), "restricted"),
    ).toBe("blocked");

    await writeRules({ child: { web: { "https://allowed.test/**": true } } }, sandbox.cwd);
    expect(
      await resolvePermission(sandbox.cwd, webCheck(["https://allowed.test/data"]), "restricted"),
    ).toBe("allowed");
  });

  it("lets explicit denial override implicit file allowance", async () => {
    const projectFile = join(sandbox.cwd, "src", "index.ts");
    const readCheck = createPermissionCheck({
      sessionId: "child",
      unresolved: [`read:${projectFile}`],
    });

    expect(await resolvePermission(sandbox.cwd, { ...readCheck }, "assistant")).toBe("allowed");

    await writeRules({ project: { file: { "**/src/**": "blocked" } } }, sandbox.cwd);
    expect(await resolvePermission(sandbox.cwd, readCheck, "assistant")).toBe("blocked");
  });

  it("asks for restricted writes and paths outside allowed roots", async () => {
    const projectWrite = createPermissionCheck({
      sessionId: "child",
      toolName: "write",
      unresolved: [`write:${join(sandbox.cwd, "src", "index.ts")}`],
    });
    const outsideRead = createPermissionCheck({
      sessionId: "child",
      unresolved: [`read:${join(sandbox.directory, "outside.txt")}`],
    });

    expect(await resolvePermission(sandbox.cwd, projectWrite, "restricted")).toBe("ask");
    expect(await resolvePermission(sandbox.cwd, outsideRead, "assistant")).toBe("ask");
  });

  it.each([
    [
      { web: { "https://one.test/**": true, "https://two.test/**": true } },
      ["https://one.test/a", "https://two.test/b"],
      "allowed",
    ],
    [
      { web: { "https://one.test/**": true } },
      ["https://one.test/a", "https://unknown.test/b"],
      "ask",
    ],
    [
      { web: { "https://one.test/**": true, "https://two.test/**": false } },
      ["https://one.test/a", "https://two.test/b"],
      "blocked",
    ],
    [
      { web: { "https://one.test/**": false, "https://two.test/**": true } },
      ["https://one.test/a", "https://two.test/b"],
      "blocked",
    ],
  ] as const)("combines checks with denial winning", async (project, unresolved, expected) => {
    await writeRules({ project }, sandbox.cwd);

    expect(await resolvePermission(sandbox.cwd, webCheck([...unresolved]), "assistant")).toBe(expected);
  });
});
