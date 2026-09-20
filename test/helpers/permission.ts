import type { PermissionCheck } from "../../src/permission/types.js";

export function createPermissionCheck(overrides: Partial<PermissionCheck> = {}): PermissionCheck {
  return {
    sessionId: "session-1",
    toolName: "read",
    category: "file",
    raw: "src/index.ts",
    extracted: ["read:src/index.ts"],
    purpose: "Read source file",
    ...overrides,
  };
}
