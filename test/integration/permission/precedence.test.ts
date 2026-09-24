import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makePermissionWorkspace, type PermissionWorkspace } from "../../helpers/permission.js";
import { resolvePiIgnorePathBlock } from "../../../src/permission/piignore.js";
import { resolvePermission } from "../../../src/permission/resolution.js";
import { writeRules } from "../../../src/permission/storage.js";
import { getPermissionCheck } from "../../../src/permission/helpers.js";

let workspace: PermissionWorkspace;

beforeEach(async () => {
  workspace = await makePermissionWorkspace("surgent-permission-integration-", true);
});

afterEach(async () => {
  await workspace.restore();
});

async function permissionCheck(toolName: "read" | "write" | "web_fetch" | "bash", raw: string) {
  const input = toolName === "web_fetch" ? { url: raw } : toolName === "bash" ? { command: raw, purpose: "test" } : { path: raw };
  const check = await getPermissionCheck(workspace.cwd, "session-1", toolName, input);
  if (!check) throw new Error("Missing permission check");
  return check;
}

describe("persisted permission precedence", () => {
  it.each(["session-1", "project"])("honors explicit %s write grants in restricted mode", async (scope) => {
    await writeRules({ [scope]: { file: { "src/file.ts": "write" } } }, workspace.cwd);

    await expect(resolvePermission(workspace.cwd, await permissionCheck("write", "src/file.ts"), "restricted"))
      .resolves.toBe("allowed");
  });

  it("auto-allows reads in the global Pi directory but not restricted writes", async () => {
    const path = relative(workspace.cwd, join(workspace.home, ".pi", "agent", "settings.json"));

    await expect(resolvePermission(workspace.cwd, await permissionCheck("read", `${path}`), "restricted"))
      .resolves.toBe("allowed");
    await expect(resolvePermission(workspace.cwd, await permissionCheck("write", `${path}`), "restricted"))
      .resolves.toBe("ask");
  });

  it("retains global file denies while ignoring global file grants in restricted mode", async () => {
    await writeRules({ file: { "src/allowed.ts": "write", "src/blocked.ts": "deny" } });

    await expect(resolvePermission(workspace.cwd, await permissionCheck("write", "src/allowed.ts"), "restricted"))
      .resolves.toBe("ask");
    await expect(resolvePermission(workspace.cwd, await permissionCheck("read", "src/blocked.ts"), "restricted"))
      .resolves.toBe("deny");
  });

  it("orders equal-ranked scopes from session to parent session to project to global", async () => {
    await writeRules({ web: { "https://example.com": false } });
    await writeRules(
      {
        project: { web: { "https://example.com": true } },
        parent: { web: { "https://example.com": false } },
        "session-1": { web: { "https://example.com": true } },
      },
      workspace.cwd,
    );
    await writeFile(join(workspace.cwd, ".pi", "subsessions.json"), JSON.stringify({ "session-1": { pid: "parent" } }));

    await expect(resolvePermission(workspace.cwd, await permissionCheck("web_fetch", "https://example.com"), "assistant")).resolves.toBe("allowed");

    await writeRules(
      {
        project: { web: { "https://example.com": true } },
        parent: { web: { "https://example.com": false } },
      },
      workspace.cwd,
    );

    await expect(resolvePermission(workspace.cwd, await permissionCheck("web_fetch", "https://example.com"), "assistant")).resolves.toBe("deny");
  });

  it("lets more-specific rules override broader rules across scopes", async () => {
    await writeRules({ file: { "**/*.ts": "deny" } });
    await writeRules({ project: { file: { "**/safe.ts": "read" } } }, workspace.cwd);

    await expect(resolvePermission(workspace.cwd, await permissionCheck("read", "src/safe.ts"), "assistant")).resolves.toBe("allowed");
  });

  it("passes file operations and bash matching into matcher", async () => {
    await writeRules({ file: { "src/**": "read" }, bash: { "git *": true } });

    await expect(resolvePermission(workspace.cwd, await permissionCheck("write", "src/file.ts"), "assistant")).resolves.toBe("deny");
    await expect(resolvePermission(workspace.cwd, await permissionCheck("bash", "git status"), "assistant")).resolves.toBe("allowed");
  });

  it("keeps unresolved bash commands while any denied command denies the whole request", async () => {
    const mixedAsk = await permissionCheck("bash", "git status && pnpm test");
    await writeRules({ bash: { "git status": true } });

    await expect(resolvePermission(workspace.cwd, mixedAsk, "assistant")).resolves.toBe("ask");
    expect(mixedAsk).toMatchObject({ unresolved: ["pnpm test"] });

    await writeRules({ bash: { "git status": true, "pnpm test": false } });
    await expect(resolvePermission(workspace.cwd, await permissionCheck("bash", "git status && pnpm test"), "assistant"))
      .resolves.toBe("deny");
  });

  it("honors explicit file denies over in-root auto allow and asks outside root", async () => {
    await writeRules({ project: { file: { "src/blocked.ts": "deny" } } }, workspace.cwd);

    await expect(resolvePermission(workspace.cwd, await permissionCheck("read", "src/blocked.ts"), "assistant")).resolves.toBe("deny");
    await expect(resolvePermission(workspace.cwd, await permissionCheck("read", "src/open.ts"), "assistant")).resolves.toBe("allowed");
    await expect(resolvePermission(workspace.cwd, await permissionCheck("read", "../outside.ts"), "assistant")).resolves.toBe("ask");
  });
});

describe(".piignore precedence", () => {
  it("uses specificity, scope, and block ties independent of line order", async () => {
    await writeFile(join(workspace.cwd, ".piignore"), "!src/safe.ts\n*.ts\nsecret.ts\n!secret.ts\n");
    await writeFile(join(workspace.home, ".pi", "agent", ".piignore"), "src/safe.ts\n");

    await expect(resolvePiIgnorePathBlock(workspace.cwd, join(workspace.cwd, "src", "safe.ts"))).resolves.toBeNull();
    await expect(resolvePiIgnorePathBlock(workspace.cwd, join(workspace.cwd, "secret.ts"))).resolves.toContain("secret.ts");
  });

  it("handles directory rules and ignores paths outside the project root", async () => {
    await mkdir(join(workspace.cwd, "dist"), { recursive: true });
    await writeFile(join(workspace.cwd, ".piignore"), "dist/\n");

    await expect(resolvePiIgnorePathBlock(workspace.cwd, join(workspace.cwd, "dist", "out.js"))).resolves.toContain("dist/");
    await expect(resolvePiIgnorePathBlock(workspace.cwd, join(workspace.root, "outside.ts"))).resolves.toBeNull();
  });
});
