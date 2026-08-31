#!/usr/bin/env node

import { main } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.title = "surgent";
const args = process.argv.slice(2);

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AGENT_ENTRY_URL = import.meta.resolve("@earendil-works/pi-coding-agent");
const CLEAR_SCREEN = "\x1b[H\x1b[2J\x1b[3J";

function isMissingFileError(error) {
  return Boolean(error) && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

async function getGitExcludePath(cwd) {
  try {
    const excludePath = (
      await new Promise((resolveOutput, rejectOutput) => {
        let stdout = "";
        const childProcess = spawn(
          process.platform === "win32" ? "git.cmd" : "git",
          ["rev-parse", "--git-path", "info/exclude"],
          { cwd, env: process.env, stdio: ["ignore", "pipe", "ignore"] },
        );

        childProcess.stdout.on("data", (chunk) => {
          stdout += chunk.toString();
        });

        childProcess.on("error", (error) => {
          rejectOutput(error);
        });

        childProcess.on("close", (exitCode) => {
          if (exitCode === 0) {
            resolveOutput(stdout);
            return;
          }
          rejectOutput(new Error("Git exclude path resolution failed."));
        });
      })
    ).trim();

    if (!excludePath) return undefined;
    return resolve(cwd, excludePath);
  } catch (error) {
    return undefined;
  }
}

async function ensurePiExcluded(cwd) {
  const excludePath = await getGitExcludePath(cwd);
  if (!excludePath) return;

  let excludeContents = "";
  try {
    excludeContents = await readFile(excludePath, "utf8");
  } catch (error) {
    if (!isMissingFileError(error)) return;
  }

  const existingPatterns = excludeContents.split(/\r?\n/).map((line) => line.trim());
  if (existingPatterns.includes(".pi")) return;

  const separator = excludeContents.length > 0 && !excludeContents.endsWith("\n") ? "\n" : "";
  await writeFile(excludePath, `${excludeContents}${separator}.pi\n`);
}

async function syncPiIgnore(cwd) {
  const piIgnorePath = resolve(cwd, ".piignore");
  try {
    await readFile(piIgnorePath, "utf8");
    return;
  } catch (error) {
    if (!isMissingFileError(error)) return;
  }

  if (existsSync(resolve(cwd, ".pi"))) return;
  const gitIgnorePath = resolve(cwd, ".gitignore");
  let gitIgnoreContents = "";

  try {
    gitIgnoreContents = await readFile(gitIgnorePath, "utf8");
  } catch (error) {
    return;
  }

  await writeFile(piIgnorePath, gitIgnoreContents);
}

function isJsonModeActive(args) {
  for (let i = 0; i < args.length - 1; i++) {
    const arg = args[i];
    if (arg === "--mode" && args[i + 1] === "json") {
      return true;
    }
  }
  return false;
}

async function setupGlobalConfig() {
  const srcDir = resolve(PACKAGE_DIR, "src");
  const agentDir = resolve(homedir(), ".pi", "agent");
  if (!existsSync(agentDir)) {
    throw new Error("Missing ~/.pi/agent. Run scripts/build.mjs first.");
  }

  const entries = await readdir(srcDir, { withFileTypes: true });
  const extensions = entries.filter((e) => e.isDirectory()).map((e) => resolve(srcDir, e.name));

  let rawSettings;
  const globalSettingsPath = resolve(agentDir, "settings.json");

  try {
    rawSettings = await readFile(globalSettingsPath, "utf8");
  } catch (err) {
    // ~/.pi/agent/settings.json doesn't exist
    if (err.code !== "ENOENT") throw err;
    rawSettings = "{}";
  }

  const globalSettings = JSON.parse(rawSettings);
  globalSettings.extensions = extensions;
  await writeFile(globalSettingsPath, JSON.stringify(globalSettings, null, 2) + "\n");
}

function rewriteHelpLine(line) {
  if (/^pi\b/.test(line)) {
    return line.replace(/^pi\b/, "surgent");
  }
  if (/^(\s+)pi\b/.test(line)) {
    return line.replace(/^(\s+)pi\b/, "$1surgent");
  }
  if (/^Alias:\s+pi\b/.test(line)) {
    return line.replace(/^Alias:\s+pi\b/, "Alias: surgent");
  }
  return line.replace(/(["'`])pi(?=[\s-])/g, "$1surgent");
}

function rewriteHelpText(text) {
  return text.split("\n").map(rewriteHelpLine).join("\n");
}

async function runRewrittenHelp(args) {
  const cliPath = fileURLToPath(new URL("./cli.js", AGENT_ENTRY_URL));

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      stdio: ["inherit", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (stdout) process.stdout.write(rewriteHelpText(stdout));
      if (stderr) process.stderr.write(rewriteHelpText(stderr));
      process.exitCode = code ?? 0;
      resolve();
    });
  });
}

if (args.includes("--help") || args.includes("-h")) {
  await runRewrittenHelp(args);
} else {
  const cwd = process.cwd();
  if (!isJsonModeActive(args)) {
    await ensurePiExcluded(cwd);
    await syncPiIgnore(cwd);
  }
  await mkdir(resolve(cwd, ".pi", "agents"), { recursive: true });
  if (!isJsonModeActive(args)) {
    await setupGlobalConfig();
    process.stdout.write(CLEAR_SCREEN);
    process.on("exit", (code) => {
      if (code === 0) process.stdout.write(CLEAR_SCREEN);
    });
  }
  await main(args);
}
