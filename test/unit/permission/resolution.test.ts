import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkAgentRules,
  expandFilePath,
  getRelativePathInRoot,
} from "../../../src/permission/resolution.js";
import { createPermissionCheck } from "../../helpers/permission.js";

describe("checkAgentRules", () => {
  it("allows a category when its allowlist is absent", () => {
    expect(checkAgentRules({}, createPermissionCheck())).toBe(true);
  });

  it("requires every Bash command to match the Bash allowlist", () => {
    const check = createPermissionCheck({
      toolName: "bash",
      category: "bash",
      extracted: ["git status", "git diff"],
    });

    expect(checkAgentRules({ bash: ["git *"] }, check)).toBe(true);
    expect(checkAgentRules({ bash: ["git status"] }, check)).toBe(false);
    expect(checkAgentRules({ bash: [] }, check)).toBe(false);
  });

  it("uses separate file allowlists for reads and writes", () => {
    const check = createPermissionCheck({
      extracted: ["read:src/a.ts", "write:src/b.ts"],
    });

    expect(checkAgentRules({ "files.read": ["src/**"], "files.write": ["src/**"] }, check)).toBe(
      true,
    );
    expect(checkAgentRules({ "files.read": ["src/**"], "files.write": ["docs/**"] }, check)).toBe(
      false,
    );
  });

  it("checks MCP tools against their allowlist", () => {
    const check = createPermissionCheck({
      toolName: "call_mcp_tool",
      category: "mcp",
      extracted: ["github:search", "github:get_issue"],
    });

    expect(checkAgentRules({ mcp_tools: ["github:*"] }, check)).toBe(true);
    expect(checkAgentRules({ mcp_tools: ["github:search"] }, check)).toBe(false);
  });

  it("does not apply agent metadata restrictions to web checks", () => {
    const check = createPermissionCheck({
      toolName: "web_fetch",
      category: "web",
      extracted: ["https://example.com"],
    });

    expect(checkAgentRules({}, check)).toBe(true);
  });
});

describe("expandFilePath", () => {
  it("expands relative and absolute paths", () => {
    const root = resolve("workspace");
    const absolute = resolve(root, "src/index.ts");

    expect(expandFilePath("src/index.ts", root)).toBe(absolute);
    expect(expandFilePath(absolute, root)).toBe(absolute);
    expect(expandFilePath("", root)).toBeNull();
  });

  it("expands home-relative paths", () => {
    expect(expandFilePath("~", resolve("workspace"))).toBe(homedir());
    expect(expandFilePath("~/src", resolve("workspace"))).toBe(resolve(homedir(), "src"));
  });
});

describe("getRelativePathInRoot", () => {
  it("returns relative paths for root and descendants", () => {
    const root = resolve("workspace");

    expect(getRelativePathInRoot(root, root)).toBe("");
    expect(getRelativePathInRoot(join(root, "src/index.ts"), root)).toBe(join("src", "index.ts"));
    expect(getRelativePathInRoot("src/../README.md", root)).toBe("README.md");
  });

  it("rejects parent, sibling, and external paths", () => {
    const root = resolve("workspace");

    expect(getRelativePathInRoot("..", root)).toBeNull();
    expect(getRelativePathInRoot(join(dirname(root), "workspace-other"), root)).toBeNull();
    expect(getRelativePathInRoot(join(dirname(root), "external/file.ts"), root)).toBeNull();
    expect(getRelativePathInRoot("", root)).toBeNull();
  });
});
