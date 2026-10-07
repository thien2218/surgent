import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, onTestFinished } from "vitest";

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "surgent-build-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const sourceDir = join(root, "src", "optimizer");
  const outputDir = join(root, "dist", "optimizer");
  const home = join(root, "home");
  const manifest = {
    name: "surgent",
    version: "1.2.3-test.4",
    type: "module",
    engines: { node: ">=22.19" },
    license: "MIT",
    dependencies: { picomatch: "^4.0.4", "tree-sitter": "^0.25.0", unrelated: "^1.0.0" },
  };
  await Promise.all([
    mkdir(join(root, "bin")),
    mkdir(join(root, "node_modules")),
    mkdir(sourceDir, { recursive: true }),
    mkdir(outputDir, { recursive: true }),
    mkdir(home),
  ]);
  await Promise.all([
    copyFile(new URL("../../../bin/build.mjs", import.meta.url), join(root, "bin", "build.mjs")),
    symlink(dirname(dirname(fileURLToPath(import.meta.resolve("esbuild")))), join(root, "node_modules", "esbuild"), "junction"),
    writeFile(join(root, "package.json"), JSON.stringify(manifest)),
    writeFile(join(root, "LICENSE"), "Fixture license\n"),
    writeFile(join(sourceDir, "README.md"), "# Fixture optimizer\n"),
    writeFile(join(sourceDir, "index.ts"), `
      import { value } from "fixture-external";
      import { suffix } from "./suffix.js";
      export default function message(): string { return value + suffix; }
    `),
    writeFile(join(sourceDir, "suffix.ts"), 'export const suffix: string = " bundled";'),
  ]);
  const env = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: home,
    PI_OFFLINE: "1",
  };
  return {
    root,
    outputDir,
    manifest,
    run(args: string[]) {
      const result = spawnSync(process.execPath, args, {
        cwd: home, env, encoding: "utf8", timeout: 10_000,
      });
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status, result.stderr).toBe(0);
      return result;
    },
  };
}

describe("optimizer package build", () => {
  it("emits a loadable ESM package with bundled local code and external dependencies", async () => {
    const fixture = await setup();

    fixture.run([join(fixture.root, "bin", "build.mjs")]);

    const manifest = JSON.parse(await readFile(join(fixture.outputDir, "package.json"), "utf8"));
    expect(manifest).toMatchObject({
      name: "pi-optimizer",
      version: fixture.manifest.version,
      type: "module",
      main: "./index.js",
      exports: "./index.js",
      engines: fixture.manifest.engines,
      license: fixture.manifest.license,
      pi: { extensions: ["./index.js"] },
    });
    expect(manifest.dependencies).toEqual({ picomatch: "^4.0.4", "tree-sitter": "^0.25.0" });
    expect(manifest.peerDependencies).toEqual({
      "@earendil-works/pi-coding-agent": "*",
      "@earendil-works/pi-tui": "*",
      typebox: "*",
    });
    expect(await readFile(join(fixture.outputDir, "LICENSE"), "utf8")).toBe("Fixture license\n");
    expect(await readFile(join(fixture.outputDir, "README.md"), "utf8")).toBe("# Fixture optimizer\n");
    const sourceMap = JSON.parse(await readFile(join(fixture.outputDir, "index.js.map"), "utf8"));
    expect(sourceMap.version).toBe(3);
    expect(sourceMap.sources).toEqual(expect.arrayContaining([
      "../../src/optimizer/index.ts", "../../src/optimizer/suffix.ts",
    ]));

    // Install the external package only after building, and remove local sources.
    const externalDir = join(fixture.root, "node_modules", "fixture-external");
    await mkdir(externalDir);
    await writeFile(join(externalDir, "package.json"), JSON.stringify({ type: "module", exports: "./index.js" }));
    await writeFile(join(externalDir, "index.js"), 'export const value = "external";');
    await rm(join(fixture.root, "src"), { recursive: true });
    const entryUrl = pathToFileURL(join(fixture.outputDir, manifest.exports)).href;
    const result = fixture.run(["--input-type=module", "-e", `import message from ${JSON.stringify(entryUrl)}; console.log(message());`]);
    expect(result.stdout).toBe("external bundled\n");
  }, 25_000);

  it("removes stale optimizer artifacts without deleting sibling distributions", async () => {
    const fixture = await setup();
    await writeFile(join(fixture.outputDir, "stale.js"), "old output");
    await writeFile(join(fixture.root, "dist", "keep.txt"), "other distribution");

    fixture.run([join(fixture.root, "bin", "build.mjs")]);

    await expect(stat(join(fixture.outputDir, "stale.js"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await stat(join(fixture.outputDir, "index.js"))).isFile()).toBe(true);
    expect(await readFile(join(fixture.root, "dist", "keep.txt"), "utf8")).toBe("other distribution");
  }, 15_000);
});
