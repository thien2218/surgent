import { cp, mkdir, readFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { packageRoot, setupCli } from "../helpers/cli.js";

it("starts the built package outside the checkout with real extensions", async () => {
  const fixture = await setupCli();
  const stage = join(fixture.root, "stage");
  const artifacts = join(fixture.root, "artifacts");
  const unpacked = join(fixture.root, "unpacked");
  await Promise.all([mkdir(stage), mkdir(artifacts), mkdir(unpacked)]);
  await Promise.all(["package.json", "bin", "src", "LICENSE"].map((path) =>
    cp(join(packageRoot, path), join(stage, path), { recursive: true })));
  // Reuse installed dependencies, never install from a registry during tests.
  await symlink(join(packageRoot, "node_modules"), join(stage, "node_modules"), "dir");
  const built = await fixture.run(process.execPath, [join(stage, "bin", "build.mjs")], stage);
  expect(built.status, built.stderr).toBe(0);
  const packed = await fixture.run("npm", ["pack", "--offline", "--ignore-scripts", "--json", "--pack-destination", artifacts], stage);
  expect(packed.status, packed.stderr).toBe(0);
  const [manifest] = JSON.parse(packed.stdout);
  expect(manifest.files).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: "bin/surgent.js" }),
    expect.objectContaining({ path: "dist/optimizer/index.js" }),
    expect.objectContaining({ path: "src/agent/index.ts" }),
  ]));
  const extracted = await fixture.run("tar", ["-xzf", join(artifacts, manifest.filename), "-C", unpacked]);
  expect(extracted.status, extracted.stderr).toBe(0);
  const installed = join(unpacked, "package");
  await symlink(join(packageRoot, "node_modules"), join(installed, "node_modules"), "dir");
  await rm(stage, { recursive: true, force: true });
  const metadata = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));

  const session = await fixture.rpc(["--no-session"], fixture.workspace, join(installed, metadata.bin.surgent));

  const commands = await session.request("get_commands");
  expect(commands.commands).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: "agents", source: "extension" }),
    expect.objectContaining({ name: "permissions", source: "extension" }),
  ]));
  await session.close();
}, 120_000);
