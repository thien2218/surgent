#!/usr/bin/env node

import { main } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.title = "surgent";
const args = process.argv.slice(2);

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLEAR_SCREEN = "\x1b[H\x1b[2J\x1b[3J";
const NON_EXTENSION_DIRS = new Set(["subsession"]);

async function setupGlobalConfig() {
  const srcDir = resolve(PACKAGE_DIR, "src");
  const agentDir = resolve(homedir(), ".pi", "agent");

  const entries = await readdir(srcDir, { withFileTypes: true });
  const extensions = entries
    .filter((e) => e.isDirectory() && !NON_EXTENSION_DIRS.has(e.name))
    .map((e) => resolve(srcDir, e.name));

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
  const cliPath = fileURLToPath(new URL("./cli.js", agentEntryUrl));

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
  await setupGlobalConfig();
  process.stdout.write(CLEAR_SCREEN);
  process.on("exit", (code) => {
    if (code === 0) {
      process.stdout.write(CLEAR_SCREEN);
    }
  });
  await main(args);
}
