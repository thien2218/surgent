import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makePermissionWorkspace, type PermissionWorkspace } from "../../helpers/permission.js";
import { cleanupPermissions } from "../../../src/cleanup/permission.js";
import { findScopedPermission } from "../../../src/permission/precedence.js";
import { readRules, writeRules } from "../../../src/permission/storage.js";

let workspace: PermissionWorkspace;

beforeEach(async () => {
  workspace = await makePermissionWorkspace("surgent-cleanup-permission-");
});

afterEach(async () => {
  await workspace.restore();
});

describe("permission cleanup", () => {
  it("removes same-access rules subsumed by broader matches", async () => {
    await writeRules(
      {
        project: {
          file: { "src/**": "read", "src/file.ts": "read", "src/write.ts": "write" },
          web: { "https://example.com/**": true, "https://example.com/page": true },
        },
      },
      workspace.cwd,
    );

    await cleanupPermissions(workspace.cwd, new Set());

    await vi.waitFor(async () => {
      await expect(readRules(workspace.cwd)).resolves.toMatchObject({
        project: {
          file: { "src/**": "read", "src/write.ts": "write" },
          web: { "https://example.com/**": true },
        },
      });
    });
  });

  it("keeps conflicting rules that change representative decisions", async () => {
    await writeRules({ web: { "https://example.com/**": true, "https://example.com/private": false } });

    await cleanupPermissions(workspace.cwd, new Set());

    await vi.waitFor(async () => {
      const global = await readRules();
      expect(global.web).toEqual({ "https://example.com/**": true, "https://example.com/private": false });
      expect(findScopedPermission([global.web ?? {}], "https://example.com/private")).toBe("deny");
      expect(findScopedPermission([global.web ?? {}], "https://example.com/public")).toBe("allowed");
    });
  });

  it("uses bash wildcard matching for slash-containing commands", async () => {
    await writeRules({ bash: { "git *": true, "git status --short": true, "npm *": false } });

    await cleanupPermissions(workspace.cwd, new Set());

    await vi.waitFor(async () => {
      await expect(readRules()).resolves.toEqual({ bash: { "git *": true, "npm *": false } });
    });
  });
});
