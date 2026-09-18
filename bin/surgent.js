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
const LOCAL_PI_SUBDIRS = ["agents", "plans"];
const BUILT_IN_META = {
  documenter: {
    tools: ["code_map", "inspect", "read", "find", "grep", "ls", "edit", "write", "questionnaire"],
    "files.write": ["**/*.md"],
  },
  planner: {
    tools: ["read", "grep", "find", "ls", "web_fetch", "web_search", "questionnaire"],
  },
  scout: {
    tools: ["ls", "find", "grep", "code_map", "inspect", "read", "web_fetch", "web_search"],
  },
};

function isMissingFileError(error) {
  return Boolean(error) && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

async function initBuiltInMeta() {
  const settingsPath = resolve(homedir(), ".pi", "agent", "settings.json");
  let settings;

  try {
    settings = JSON.parse(await readFile(settingsPath, "utf8"));
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
    settings = {};
  }

  const meta = { ...settings.agent?.meta };
  let changed = false;
  for (const [name, builtInMeta] of Object.entries(BUILT_IN_META)) {
    if (Object.hasOwn(meta, name)) continue;
    meta[name] = builtInMeta;
    changed = true;
  }
  if (!changed) return;

  settings.agent = { ...settings.agent, meta };
  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
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

    if (excludePath) {
      return resolve(cwd, excludePath);
    }
  } catch {}
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

await initBuiltInMeta();

if (args.includes("--help") || args.includes("-h")) {
  await runRewrittenHelp(args);
} else {
  const cwd = process.cwd();
  if (!isJsonModeActive(args)) {
    await ensurePiExcluded(cwd);
    await syncPiIgnore(cwd);
  }
  for (const localPiSubdir of LOCAL_PI_SUBDIRS) {
    await mkdir(resolve(cwd, ".pi", localPiSubdir), { recursive: true });
  }

  const srcDir = resolve(PACKAGE_DIR, "src");
  const entries = await readdir(srcDir, { withFileTypes: true });
  const extensionArgs = entries
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => ["--extension", resolve(srcDir, entry.name)]);
  await main([...extensionArgs, ...args]);
}
