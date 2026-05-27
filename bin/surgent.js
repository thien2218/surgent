#!/usr/bin/env node

import { main } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.title = "surgent";
const args = process.argv.slice(2);

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function piSetup() {
  const agentEntryUrl = await import.meta.resolve("@earendil-works/pi-coding-agent");
  const cliPath = fileURLToPath(new URL("./cli.js", agentEntryUrl));

  await new Promise((resolve, reject) => {
    // Run `pi list` to lazy init settings
    const child = spawn(process.execPath, [cliPath, "list"], {
      stdio: "ignore",
      env: process.env,
    });
    child.on("error", reject);
    child.on("close", resolve);
  });
}

async function setupGlobalConfig() {
  const srcDir = resolve(packageDir, "src");
  const agentDir = resolve(homedir(), ".pi", "agent");

  const entries = await readdir(srcDir, { withFileTypes: true });
  const extensions = entries
    .filter((e) => e.isDirectory())
    .map((e) => resolve(srcDir, e.name));

  const globalSettingsPath = resolve(agentDir, "settings.json");

  let rawSettings;
  try {
    rawSettings = await readFile(globalSettingsPath, "utf8");
  } catch (err) {
    // ~/.pi/agent/ doesn't exist
    if (err.code !== "ENOENT") throw err;
    await piSetup();
    rawSettings = await readFile(globalSettingsPath, "utf8");
  }

  const globalSettings = JSON.parse(rawSettings);
  globalSettings.extensions = extensions;
  await writeFile(globalSettingsPath, JSON.stringify(globalSettings, null, 2) + "\n");
}

const CLEAR_SCREEN = "\x1b[H\x1b[2J\x1b[3J";

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
  return text
    .split("\n")
    .map(rewriteHelpLine)
    .join("\n");
}

async function runRewrittenHelp(args) {
  const agentEntryUrl = await import.meta.resolve("@earendil-works/pi-coding-agent");
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
