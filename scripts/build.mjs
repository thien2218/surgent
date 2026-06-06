#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const gitIgnorePath = resolve(projectRoot, ".gitignore");
const piIgnorePath = resolve(projectRoot, ".piignore");

async function main() {
  process.chdir(projectRoot);

  console.log("Adding .pi to git exclude file...");
  await ensurePiExcluded();

  console.log("Installing dependencies...");
  await runCommand("pnpm", ["install"]);

  console.log("Linking package with npm link...");
  await runCommand("npm", ["link"]);

  console.log("Syncing .piignore from .gitignore...");
  await syncPiIgnore();
}

async function ensurePiExcluded() {
  const excludePath = await getGitExcludePath();
  const excludeDir = dirname(excludePath);
  await mkdir(excludeDir, { recursive: true });

  let excludeContents = "";
  try {
    excludeContents = await readFile(excludePath, "utf8");
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  const existingPatterns = excludeContents
    .split(/\r?\n/)
    .map((line) => line.trim());

  if (existingPatterns.includes(".pi")) {
    return;
  }

  const separator = excludeContents.length > 0 && !excludeContents.endsWith("\n") ? "\n" : "";
  await writeFile(excludePath, `${excludeContents}${separator}.pi\n`);
}

async function getGitExcludePath() {
  const excludePath = (await getCommandOutput("git", ["rev-parse", "--git-path", "info/exclude"])).trim();

  if (!excludePath) {
    throw new Error("Could not resolve .git/info/exclude path.");
  }

  return resolve(projectRoot, excludePath);
}

async function syncPiIgnore() {
  try {
    await readFile(piIgnorePath, "utf8");
    return;
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  const gitIgnoreContents = await readFile(gitIgnorePath, "utf8");
  await writeFile(piIgnorePath, gitIgnoreContents);
}

async function getCommandOutput(commandName, commandArgs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const childProcess = spawn(resolveCommandName(commandName), commandArgs, {
      cwd: projectRoot,
      env: process.env,
      stdio: ["inherit", "pipe", "inherit"],
    });

    let stdout = "";

    childProcess.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    childProcess.on("error", (error) => {
      rejectPromise(error);
    });

    childProcess.on("close", (exitCode) => {
      if (exitCode === 0) {
        resolvePromise(stdout);
        return;
      }

      rejectPromise(new Error(`Command failed: ${commandName} ${commandArgs.join(" ")}`));
    });
  });
}

async function runCommand(commandName, commandArgs) {
  await new Promise((resolvePromise, rejectPromise) => {
    const childProcess = spawn(resolveCommandName(commandName), commandArgs, {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit",
    });

    childProcess.on("error", (error) => {
      rejectPromise(error);
    });

    childProcess.on("close", (exitCode) => {
      if (exitCode === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(`Command failed: ${commandName} ${commandArgs.join(" ")}`));
    });
  });
}

function resolveCommandName(commandName) {
  return process.platform === "win32" ? `${commandName}.cmd` : commandName;
}

function isMissingFileError(error) {
  return Boolean(error) && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
