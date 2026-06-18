#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const gitIgnorePath = resolve(projectRoot, ".gitignore");
const piIgnorePath = resolve(projectRoot, ".piignore");
const localPiDirPath = resolve(projectRoot, ".pi");

async function main() {
  process.chdir(projectRoot);

  console.log("Adding .pi to git exclude file...");
  await ensurePiExcluded();

  console.log("Installing dependencies...");
  await installDependencies();

  console.log("Linking package with npm link...");
  await runCommand("npm", ["link"]);

  console.log("Syncing .piignore from .gitignore...");
  await syncPiIgnore();

  console.log("Ensuring existence of local .pi/ and global ~/.pi/agent/ dirs");
  await ensurePiDirs();
}

async function ensurePiExcluded() {
  let excludeContents = "";
  const excludePath = await getGitExcludePath();
  await mkdir(dirname(excludePath), { recursive: true });

  try {
    excludeContents = await readFile(excludePath, "utf8");
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  const existingPatterns = excludeContents.split(/\r?\n/).map((line) => line.trim());

  if (existingPatterns.includes(".pi")) {
    return;
  }

  const separator = excludeContents.length > 0 && !excludeContents.endsWith("\n") ? "\n" : "";
  await writeFile(excludePath, `${excludeContents}${separator}.pi\n`);
}

async function getGitExcludePath() {
  const excludePath = (
    await new Promise((resolve, reject) => {
      const childProcess = spawn(
        resolveCommandName("git"),
        ["rev-parse", "--git-path", "info/exclude"],
        { cwd: projectRoot, env: process.env, stdio: ["inherit", "pipe", "inherit"] },
      );

      let stdout = "";

      childProcess.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      childProcess.on("error", (error) => {
        reject(error);
      });

      childProcess.on("close", (exitCode) => {
        if (exitCode === 0) {
          resolve(stdout);
          return;
        }
        reject(new Error(`Command failed: ${commandName} ${commandArgs.join(" ")}`));
      });
    })
  ).trim();

  if (!excludePath) {
    throw new Error("Could not resolve .git/info/exclude path.");
  }

  return resolve(projectRoot, excludePath);
}

async function installDependencies() {
  try {
    await runCommand("pnpm", ["install"]);
    return;
  } catch (error) {
    if (!isMissingCommandError(error, "pnpm")) {
      throw error;
    }
  }

  try {
    await runCommand("npm", ["install"]);
  } catch (error) {
    if (isMissingCommandError(error, "npm")) {
      throw new Error(
        "Cannot install dependencies: neither pnpm and npm are available. Install pnpm or npm first, then rerun this script.",
      );
    }
    throw error;
  }
}

function isMissingCommandError(error, commandName) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const hasMissingErrorName = "name" in error && error.name === "MissingCommandError";
  if (!hasMissingErrorName) {
    return false;
  }

  if (!commandName) {
    return true;
  }

  return "missingCommandName" in error && error.missingCommandName === commandName;
}

async function runCommand(commandName, commandArgs) {
  await new Promise((resolve, reject) => {
    const childProcess = spawn(resolveCommandName(commandName), commandArgs, {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit",
    });

    childProcess.on("error", (error) => {
      reject(error);
    });

    childProcess.on("close", (exitCode) => {
      if (exitCode === 0) {
        resolve();
        return;
      }

      reject(new Error(`Command failed: ${commandName} ${commandArgs.join(" ")}`));
    });
  });
}

function resolveCommandName(commandName) {
  return process.platform === "win32" ? `${commandName}.cmd` : commandName;
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

  if (existsSync(localPiDirPath)) {
    return;
  }

  const gitIgnoreContents = await readFile(gitIgnorePath, "utf8");
  await writeFile(piIgnorePath, gitIgnoreContents);
}

async function ensurePiDirs() {
  const globalSubsessionDirPath = resolve(homedir(), ".pi", "agent");
  await Promise.all([
    mkdir(localPiDirPath, { recursive: true }),
    mkdir(globalSubsessionDirPath, { recursive: true }),
  ]);
}

function isMissingFileError(error) {
  return Boolean(error) && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
