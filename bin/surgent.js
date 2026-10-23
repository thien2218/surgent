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

const GLOBAL_PI_DIR = resolve(homedir(), ".pi", "agent");
const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AGENT_ENTRY_URL = import.meta.resolve("@earendil-works/pi-coding-agent");
const LOCAL_PI_SUBDIRS = ["agents", "plans"];
const GLOBAL_PI_SUBDIRS = ["agents", "grammars"];
const GIT_EXCLUDED_PATHS = [".pi", ".piignore"];
const BASE_TOOLS = ["ls", "find", "grep", "code_map", "inspect", "read"];
const BUILT_IN_META = {
  documenter: {
    tools: BASE_TOOLS.concat(["edit", "write", "questionnaire"]),
    "files.write": ["**/*.md"],
  },
  planner: {
    tools: BASE_TOOLS.concat(["web_fetch", "web_search", "questionnaire"]),
  },
  scout: {
    tools: BASE_TOOLS.concat(["web_fetch", "web_search"]),
  },
};
const BASE_PROMPT = `<rules priority="first">
- NEVER touch unrecognized files/changes, treat them as user work.
- DON'T re-read files already in conversation unless justified; those results stay current.
- DON'T use a skill based solely on keywords, superficial relevance, or its availability.
- DON'T reload skills already in conversation unless needed. "Use/read before work" means "apply already-loaded content".
- PREFER batching independent tool calls already known. But avoid deliberating to grow batch, no speculative "just in case" calls.
- ONLY report if requirements are met, even when sustained work is required.
</rules>

<optimization priority="second" target="input tokens">
1. Token consumption by read-only tools in asc order: 'ls' → 'find' → 'grep' → 'code_map' → 'inspect' → 'read'. Use the right tool for the right purpose.
2. Re-read content only with evidence of file changes or required content truncated or unavailable. Identify gap first; fetch only changed/missing region. Do NOT run freshness checks solely to justify re-reading.
3. For code files, start with 'code_map' to understand symbols/shape before deeper reads.
4. Use 'inspect' for minimal symbol body needed to answer/fix.
5. Use 'read' on code only when region is uninspectable.
6. 'read' on code MUST HAVE offset + limit inferred from 'code_map' output unless unavailable.
</optimization>
`;

function isMissingFileError(error) {
  return Boolean(error) && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

async function initBuiltInMeta() {
  const settingsPath = resolve(GLOBAL_PI_DIR, "settings.json");
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

// Pi reads SYSTEM.md before any extension runs, so it must be current before launch.
async function writeSystemPrompt() {
  const systemPath = resolve(GLOBAL_PI_DIR, "SYSTEM.md");
  // Skip identical writes so concurrent launches never read a truncated file.
  try {
    if ((await readFile(systemPath, "utf8")) === BASE_PROMPT) return;
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
  await mkdir(GLOBAL_PI_DIR, { recursive: true });
  await writeFile(systemPath, BASE_PROMPT);
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
  const missingPatterns = GIT_EXCLUDED_PATHS.filter(
    (pattern) => !existingPatterns.includes(pattern),
  );
  if (missingPatterns.length === 0) return;

  const separator = excludeContents.length > 0 && !excludeContents.endsWith("\n") ? "\n" : "";
  await writeFile(excludePath, `${excludeContents}${separator}${missingPatterns.join("\n")}\n`);
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

  await writeFile(piIgnorePath, `.pi\n\n${gitIgnoreContents}`);
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
await writeSystemPrompt();

if (args.includes("--help") || args.includes("-h")) {
  await runRewrittenHelp(args);
} else {
  const cwd = process.cwd();
  const srcDir = resolve(PACKAGE_DIR, "src");
  if (!isJsonModeActive(args)) {
    await Promise.all([ensurePiExcluded(cwd), syncPiIgnore(cwd)]);
  }
  const [entries] = await Promise.all([
    readdir(srcDir, { withFileTypes: true }),
    ...LOCAL_PI_SUBDIRS.map((dir) => mkdir(resolve(cwd, ".pi", dir), { recursive: true })),
    ...GLOBAL_PI_SUBDIRS.map((dir) => mkdir(resolve(GLOBAL_PI_DIR, dir), { recursive: true })),
  ]);

  const extensionArgs = entries
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => ["--extension", resolve(srcDir, entry.name)]);
  await main([...extensionArgs, ...args]);
}
