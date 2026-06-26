#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");

async function main() {
  process.chdir(projectRoot);

  console.log("Installing dependencies...");
  await installDependencies();

  console.log("Linking package with npm link...");
  await runCommand("npm", ["link"]);

  console.log("Ensuring existence of global ~/.pi/agent/ dir");
  await mkdir(resolve(homedir(), ".pi", "agent"), { recursive: true });
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

async function runCommand(cmd, args) {
  await new Promise((resolvePromise, rejectPromise) => {
    const childProcess = spawn(process.platform === "win32" ? `${cmd}.cmd` : cmd, args, {
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

      rejectPromise(new Error(`Command failed: ${cmd} ${args.join(" ")}`));
    });
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
