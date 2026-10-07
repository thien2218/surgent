import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import mapperExtension from "../../../src/optimizer/mapper/index.js";
import { writeRules } from "../../../src/permission/storage.js";
import { makePermissionContext, makePermissionSession } from "../../helpers/permission.js";
import { createWorkspace, type Workspace } from "../../helpers/workspace.js";

let workspace: Workspace;
let session: ReturnType<typeof makePermissionSession>;

beforeEach(async () => {
  workspace = await createWorkspace({ prefix: "surgent-navigation-" });
  onTestFinished(() => { vi.unstubAllEnvs(); });
  // Production auto-allows tmpdir reads; keep outside-root fixtures outside that grant.
  vi.stubEnv("TMPDIR", join(workspace.root, "tmp"));
  session = makePermissionSession();
  mapperExtension(session.api);
});

async function mapText(
  paths: string[],
  patterns?: string[],
  context = makePermissionContext(workspace.cwd),
) {
  const result = await session.tool("code_map").execute(
    "map-1", { paths, patterns }, undefined, undefined, context,
  );
  return result.content.map((block) => block.type === "text" ? block.text : "").join("\n");
}

describe("code_map navigation contract", () => {
  it("reports selected files independently when grammars are unavailable, joining patterns with OR", async () => {
    await mkdir(join(workspace.cwd, "src", "nested"), { recursive: true });
    for (const path of ["src/main.ts", "src/other.py", "src/nested/child.ts", "src/skipped.rs", "outside.ts"]) {
      await writeFile(join(workspace.cwd, path), "fixture source");
    }

    // Missing grammars expose selected paths through the real tool's per-file failures.
    // No native language packages, parser mocks, or installs are needed.
    const output = await mapText(["src"], ["*.ts", "*.py"]);

    expect(output).toContain("failed src/main.ts:");
    expect(output).toContain("failed src/other.py:");
    expect(output).toContain("failed src/nested/child.ts:");
    expect(output).toContain("grammar package not installed in cache");
    expect(output).not.toContain("skipped.rs");
    expect(output).not.toContain("outside.ts");
    expect(output.split("\n").filter((line) => line.startsWith("failed "))).toHaveLength(3);
  });

  it.each([undefined, []])("includes all files when patterns are %j", async (patterns) => {
    await writeFile(join(workspace.cwd, "first.ts"), "fixture source");
    await writeFile(join(workspace.cwd, "second.py"), "fixture source");

    const output = await mapText(["first.ts", "second.py"], patterns);

    expect(output).toContain("failed first.ts:");
    expect(output).toContain("failed second.py:");
  });

  it("treats predicate-looking paths as literal filenames rather than find arguments", async () => {
    for (const directory of ["-name", "("]) {
      await mkdir(join(workspace.cwd, directory));
      await writeFile(join(workspace.cwd, directory, "entry.ts"), "fixture source");
    }

    const output = await mapText(["-name", "("], ["*.ts"]);

    expect(output).toContain("failed ./-name/entry.ts:");
    expect(output).toContain("failed ./(/entry.ts:");
    expect(output.split("\n").filter((line) => line.startsWith("failed "))).toHaveLength(2);
  });

  it("returns an explicit empty map for an authorized unsupported file", async () => {
    await writeFile(join(workspace.cwd, "notes.txt"), "not source code");

    expect(await mapText(["notes.txt"])).toBe("(no symbols found)");
  });

  it("does not broaden the search when no pattern matches", async () => {
    await writeFile(join(workspace.cwd, "entry.ts"), "fixture source");

    await expect(mapText(["."], ["*.java"]))
      .rejects.toThrow("no read-authorized files found");
  });

  it("propagates discovery failures instead of returning a partial success", async () => {
    await writeFile(join(workspace.cwd, "present.txt"), "fixture source");

    await expect(mapText(["present.txt", "missing-path"]))
      .rejects.toThrow("missing-path");
  });
});

describe("code_map permission boundary", () => {
  it.each(["policy", "piignore", "agent"] as const)("excludes %s-denied files even in yolo mode and warns about partial coverage", async (source) => {
    await writeFile(join(workspace.cwd, "public.ts"), "fixture public source");
    await writeFile(join(workspace.cwd, "private.ts"), "fixture private source");
    if (source === "policy") {
      await writeRules({ project: { file: { "private.ts": "deny" } } }, workspace.cwd);
    }
    if (source === "piignore") {
      await writeFile(join(workspace.cwd, ".piignore"), "private.ts\n");
    }
    session = makePermissionSession({
      description: "test",
      ...(source === "agent" ? { "files.read": ["public.ts"] } : {}),
    }, "yolo");
    mapperExtension(session.api);

    const output = await mapText(["public.ts", "private.ts"]);

    expect(output).toContain("failed public.ts:");
    expect(output).not.toContain("private.ts");
    expect(output).not.toContain("fixture private source");
    expect(output).toContain("[Code map results exclude files blocked by permission policy]");
  });

  it("rejects a fully denied selection before producing a map", async () => {
    await writeFile(join(workspace.cwd, "private.ts"), "fixture private source");
    await writeRules({ project: { file: { "private.ts": "deny" } } }, workspace.cwd);

    await expect(mapText(["private.ts"]))
      .rejects.toThrow("no read-authorized files found");
  });

  it("requires approval for a directory symlink that escapes the project root", async () => {
    const outside = join(workspace.root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "private.ts"), "fixture private source");
    await symlink(outside, join(workspace.cwd, "linked"));

    await expect(mapText(["linked/private.ts"]))
      .rejects.toThrow("Permission request requires interactive UI");
  });

  it.each([
    [undefined, "Permission request was cancelled"],
    [{ allowed: false }, "User rejected this tool call"],
  ] as const)("fails closed for outside-root approval %j", async (decision, reason) => {
    await writeFile(join(workspace.root, "outside.ts"), "fixture private source");
    const context = makePermissionContext(workspace.cwd, true);
    context.ui.custom.mockResolvedValueOnce(decision);

    await expect(mapText(["../outside.ts"], undefined, context)).rejects.toThrow(reason);
    expect(context.ui.custom).toHaveBeenCalledOnce();
  });

  it("honors an explicit outside-root read grant without an interactive prompt", async () => {
    await writeFile(join(workspace.root, "outside.txt"), "fixture allowed source");
    await writeRules({ project: { file: { "../outside.txt": "read" } } }, workspace.cwd);
    const context = makePermissionContext(workspace.cwd);

    expect(await mapText(["../outside.txt"], undefined, context)).toBe("(no symbols found)");
    expect(context.ui.custom).not.toHaveBeenCalled();
  });
});
