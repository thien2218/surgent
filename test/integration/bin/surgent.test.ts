import { execFileSync, spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "surgent-cli-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  const home = join(root, "home");
  const globalDir = join(home, ".pi", "agent");
  const piDir = join(root, "node_modules", "@earendil-works", "pi-coding-agent");
  await Promise.all([
    mkdir(workspace),
    mkdir(home),
    mkdir(join(root, "bin")),
    mkdir(join(root, "src", "first"), { recursive: true }),
    mkdir(join(root, "src", "second"), { recursive: true }),
    mkdir(piDir, { recursive: true }),
  ]);
  await Promise.all([
    copyFile(new URL("../../../bin/surgent.js", import.meta.url), join(root, "bin", "surgent.js")),
    writeFile(join(root, "package.json"), JSON.stringify({ type: "module" })),
    writeFile(join(root, "src", "utils.ts"), "export {};"),
    writeFile(join(piDir, "package.json"), JSON.stringify({ type: "module", exports: "./index.js" })),
    // Record only the external Pi boundary; run Surgent's bootstrap unchanged.
    writeFile(join(piDir, "index.js"), 'export async function main(args) { console.log(JSON.stringify(args)); }'),
    writeFile(join(piDir, "cli.js"), `
      console.log('pi help\\n  pi --help\\nAlias: pi\\nRun "pi --mode json"\\nKeep pilot unchanged');
      console.error('pi diagnostic');
      process.exitCode = 7;
    `),
  ]);
  const env = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: home,
    PI_OFFLINE: "1",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(home, "gitconfig"),
    GIT_CEILING_DIRECTORIES: root,
  };
  return {
    root,
    workspace,
    globalDir,
    run(args: string[] = []) {
      const result = spawnSync(process.execPath, [join(root, "bin", "surgent.js"), ...args], {
        cwd: workspace, env, encoding: "utf8", timeout: 10_000,
      });
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      return result;
    },
    git(args: string[]) {
      return execFileSync("git", args, { cwd: workspace, env, encoding: "utf8", timeout: 10_000 });
    },
  };
}

describe("CLI bootstrap", () => {
  it("creates local and global directories and forwards extensions before user arguments", async () => {
    const fixture = await setup();
    const args = ["--mode", "json", "--extension", "custom", "prompt with spaces"];

    const result = fixture.run(args);

    expect(result.status).toBe(0);
    const forwarded = JSON.parse(result.stdout) as string[];
    expect(forwarded.slice(-args.length)).toEqual(args);
    const extensions = forwarded.slice(0, -args.length);
    expect(extensions).toHaveLength(4);
    expect(extensions.filter((entry, index) => index % 2 === 0)).toEqual(["--extension", "--extension"]);
    expect(extensions.filter((entry, index) => index % 2 === 1).sort()).toEqual([
      join(fixture.root, "src", "first"), join(fixture.root, "src", "second"),
    ]);
    for (const directory of [
      join(fixture.workspace, ".pi", "agents"), join(fixture.workspace, ".pi", "plans"),
      join(fixture.globalDir, "agents"), join(fixture.globalDir, "grammars"),
    ]) {
      expect((await stat(directory)).isDirectory()).toBe(true);
    }
    const settings = JSON.parse(await readFile(join(fixture.globalDir, "settings.json"), "utf8"));
    expect(settings.agent.meta.documenter["files.write"]).toEqual(["**/*.md"]);
    expect(settings.agent.meta.planner.tools).toContain("questionnaire");
    expect(settings.agent.meta.scout.tools).toContain("web_search");
  });

  it("preserves user settings and built-in overrides while filling missing agent metadata", async () => {
    const fixture = await setup();
    await mkdir(fixture.globalDir, { recursive: true });
    const settingsPath = join(fixture.globalDir, "settings.json");
    const settings = {
      theme: "custom",
      agent: { selected: "scout", meta: { scout: { tools: ["read"] }, custom: { tools: [] } } },
    };
    await writeFile(settingsPath, JSON.stringify(settings));

    expect(fixture.run().status).toBe(0);

    const saved = await readFile(settingsPath, "utf8");
    expect(JSON.parse(saved)).toMatchObject(settings);
    expect(JSON.parse(saved).agent.meta.documenter["files.write"]).toEqual(["**/*.md"]);
    expect(JSON.parse(saved).agent.meta.planner.tools).toContain("web_search");
    expect(fixture.run().status).toBe(0);
    expect(await readFile(settingsPath, "utf8")).toBe(saved);
  });

  it("rejects malformed settings without overwriting them or launching Pi", async () => {
    const fixture = await setup();
    await mkdir(fixture.globalDir, { recursive: true });
    const settingsPath = join(fixture.globalDir, "settings.json");
    await writeFile(settingsPath, "{broken");

    const result = fixture.run();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("SyntaxError");
    expect(result.stdout).toBe("");
    expect(await readFile(settingsPath, "utf8")).toBe("{broken");
  });

  it("copies gitignore on first startup and adds one Git exclusion without losing existing patterns", async () => {
    const fixture = await setup();
    fixture.git(["init", "--quiet"]);
    const excludePath = join(fixture.workspace, ".git", "info", "exclude");
    await writeFile(excludePath, "keep-pattern");
    await writeFile(join(fixture.workspace, ".gitignore"), "node_modules/\nsecret.env\n");

    expect(fixture.run().status).toBe(0);
    expect(fixture.run().status).toBe(0);

    expect(await readFile(excludePath, "utf8")).toBe("keep-pattern\n.pi\n");
    expect(await readFile(join(fixture.workspace, ".piignore"), "utf8"))
      .toBe(".pi\n\nnode_modules/\nsecret.env\n");
  });

  it("leaves ignore files untouched in JSON mode", async () => {
    const fixture = await setup();
    fixture.git(["init", "--quiet"]);
    const excludePath = join(fixture.workspace, ".git", "info", "exclude");
    const original = await readFile(excludePath, "utf8");
    await writeFile(join(fixture.workspace, ".gitignore"), "secret.env\n");

    expect(fixture.run(["--mode", "json"]).status).toBe(0);

    expect(await readFile(excludePath, "utf8")).toBe(original);
    await expect(stat(join(fixture.workspace, ".piignore"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves existing piignore and an existing Git exclusion", async () => {
    const fixture = await setup();
    fixture.git(["init", "--quiet"]);
    const excludePath = join(fixture.workspace, ".git", "info", "exclude");
    await writeFile(excludePath, "keep\r\n.pi\r\n");
    await writeFile(join(fixture.workspace, ".piignore"), "custom\n");
    await writeFile(join(fixture.workspace, ".gitignore"), "other\n");

    expect(fixture.run().status).toBe(0);

    expect(await readFile(excludePath, "utf8")).toBe("keep\r\n.pi\r\n");
    expect(await readFile(join(fixture.workspace, ".piignore"), "utf8")).toBe("custom\n");
  });

  it("does not seed piignore in an already initialized workspace", async () => {
    const fixture = await setup();
    await mkdir(join(fixture.workspace, ".pi"));
    await writeFile(join(fixture.workspace, ".gitignore"), "other\n");

    expect(fixture.run().status).toBe(0);

    await expect(stat(join(fixture.workspace, ".piignore"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["--help", "-h"])("rewrites %s output on both streams and preserves exit status without project setup", async (flag) => {
    const fixture = await setup();

    const result = fixture.run([flag]);

    expect(result.status).toBe(7);
    expect(result.stdout).toBe('surgent help\n  surgent --help\nAlias: surgent\nRun "surgent --mode json"\nKeep pilot unchanged\n');
    expect(result.stderr).toBe("surgent diagnostic\n");
    await expect(stat(join(fixture.workspace, ".pi"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
