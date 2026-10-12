import { execFileSync } from "node:child_process";
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
  glob?: string,
  context = makePermissionContext(workspace.cwd),
) {
  const result = await session.tool("code_map").execute(
    "map-1", { paths, glob }, undefined, undefined, context,
  );
  return result.content.map((block) => block.type === "text" ? block.text : "").join("\n");
}

describe("code_map navigation contract", () => {
  it("reports selected files independently when grammars are unavailable, filtering directories by glob", async () => {
    await mkdir(join(workspace.cwd, "src", "nested"), { recursive: true });
    for (const path of ["src/main.ts", "src/other.py", "src/nested/child.ts", "src/skipped.rs", "outside.ts"]) {
      await writeFile(join(workspace.cwd, path), "fixture source");
    }

    // Missing grammars expose selected paths through the real tool's per-file failures.
    // No native language packages, parser mocks, or installs are needed.
    const output = await mapText(["src"], "*.{ts,py}");

    expect(output).toMatch(/^src\/main\.ts:/m);
    expect(output).toMatch(/^src\/other\.py:/m);
    expect(output).toMatch(/^src\/nested\/child\.ts:/m);
    expect(output).toContain("grammar package not installed in cache");
    expect(output).not.toContain("skipped.rs");
    expect(output).not.toContain("outside.ts");
  });

  it.each([undefined, ""])("includes all files when glob is %j", async (glob) => {
    await writeFile(join(workspace.cwd, "first.ts"), "fixture source");
    await writeFile(join(workspace.cwd, "second.py"), "fixture source");

    const output = await mapText(["first.ts", "second.py"], glob);

    expect(output).toMatch(/^first\.ts:/m);
    expect(output).toMatch(/^second\.py:/m);
  });

  it("treats dash-prefixed directories as literal paths rather than rg options", async () => {
    for (const directory of ["-name", "("]) {
      await mkdir(join(workspace.cwd, directory));
      await writeFile(join(workspace.cwd, directory, "entry.ts"), "fixture source");
    }

    const output = await mapText(["-name", "("], "*.ts");

    expect(output).toMatch(/^-name\/entry\.ts:/m);
    expect(output).toMatch(/^\(\/entry\.ts:/m);
  });

  it("returns an explicit empty map for an authorized unsupported file", async () => {
    await writeFile(join(workspace.cwd, "notes.txt"), "not source code");

    expect(await mapText(["notes.txt"])).toBe("(no symbols found)");
  });

  it("does not broaden the search when no glob matches", async () => {
    await writeFile(join(workspace.cwd, "entry.ts"), "fixture source");

    await expect(mapText(["."], "*.java"))
      .rejects.toThrow("no read-authorized files found");
  });

  it.each([
    { paths: ["present.ts", "missing-path"] },
    { paths: ["missing-path"] },
  ])("reports missing paths without a tool error for $paths", async ({ paths }) => {
    await writeFile(join(workspace.cwd, "present.ts"), "export const present = true;");

    const result = await session.tool("code_map").execute(
      "map-partial", { paths }, undefined, undefined, makePermissionContext(workspace.cwd),
    );
    const output = result.content.map((block) => block.type === "text" ? block.text : "").join("\n");

    expect(result).not.toHaveProperty("isError", true);
    expect(output).toMatch(/^missing-path: no such file or directory$/m);
    for (const path of paths) {
      expect(output).toContain(path);
    }
  });

  it("skips gitignored files when scanning an unignored directory", async () => {
    execFileSync("git", ["init", "--quiet"], { cwd: workspace.cwd });
    await mkdir(join(workspace.cwd, "src", "dist"), { recursive: true });
    await writeFile(join(workspace.cwd, ".gitignore"), "dist/\n");
    await writeFile(join(workspace.cwd, "src", "main.ts"), "fixture source");
    await writeFile(join(workspace.cwd, "src", "dist", "built.ts"), "fixture source");

    const output = await mapText(["src"]);

    expect(output).toMatch(/^src\/main\.ts:/m);
    expect(output).not.toContain("built.ts");
  });

  it("scans named ignored directories while parent ignore rules still apply below them", async () => {
    execFileSync("git", ["init", "--quiet"], { cwd: workspace.cwd });
    await mkdir(join(workspace.cwd, "node_modules", "pkg", "dist"), { recursive: true });
    await writeFile(join(workspace.cwd, ".gitignore"), "node_modules\ndist/\n");
    await writeFile(join(workspace.cwd, "node_modules", "pkg", "index.ts"), "fixture source");
    await writeFile(join(workspace.cwd, "node_modules", "pkg", "dist", "built.ts"), "fixture source");

    const packageOutput = await mapText(["node_modules/pkg"]);
    const distOutput = await mapText(["node_modules/pkg/dist"]);

    expect(packageOutput).toMatch(/^node_modules\/pkg\/index\.ts:/m);
    expect(packageOutput).not.toContain("built.ts");
    expect(distOutput).toMatch(/^node_modules\/pkg\/dist\/built\.ts:/m);
  });

  it("drops unsupported directory files before permission checks", async () => {
    await mkdir(join(workspace.cwd, "src"));
    await writeFile(join(workspace.cwd, "src", "main.ts"), "fixture source");
    await writeFile(join(workspace.cwd, "src", "notes.txt"), "fixture notes");
    await writeRules({ project: { file: { "src/notes.txt": "deny" } } }, workspace.cwd);

    const output = await mapText(["src"]);

    expect(output).toMatch(/^src\/main\.ts:/m);
    expect(output).not.toContain("blocked by permission policy");
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

    expect(output).toMatch(/^public\.ts:/m);
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
