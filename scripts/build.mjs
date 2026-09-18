import { build } from "esbuild";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const optimizerDir = resolve(projectRoot, "dist", "optimizers");
const rootPackage = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));

await rm(optimizerDir, { recursive: true, force: true });
await mkdir(optimizerDir, { recursive: true });
await build({
  entryPoints: [resolve(projectRoot, "src", "optimizers", "index.ts")],
  outfile: resolve(optimizerDir, "index.js"),
  bundle: true,
  format: "esm",
  packages: "external",
  platform: "node",
  sourcemap: true,
  target: "node22",
});

const optimizerPackage = {
  name: "pi-context-optimizer",
  version: rootPackage.version,
  description: "Context optimization tools for pi coding agent",
  type: "module",
  main: "./index.js",
  exports: "./index.js",
  engines: rootPackage.engines,
  license: rootPackage.license,
  keywords: ["pi-package", "pi-coding-agent", "context-optimization"],
  pi: { extensions: ["./index.js"] },
  dependencies: {
    picomatch: rootPackage.dependencies.picomatch,
    "tree-sitter": rootPackage.dependencies["tree-sitter"],
  },
  peerDependencies: {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*",
    typebox: "*",
  },
};

await Promise.all([
  writeFile(resolve(optimizerDir, "package.json"), `${JSON.stringify(optimizerPackage, null, 2)}\n`),
  copyFile(resolve(projectRoot, "LICENSE"), resolve(optimizerDir, "LICENSE")),
  copyFile(
    resolve(projectRoot, "src", "optimizers", "README.md"),
    resolve(optimizerDir, "README.md"),
  ),
]);
