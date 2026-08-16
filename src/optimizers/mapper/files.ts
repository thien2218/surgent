import picomatch from "picomatch";
import { runCommand } from "../../utils.js";

const SKIPPED_DIRECTORIES = new Set([".git", ".pi", "build", "coverage", "dist", "node_modules"]);

function normalizePath(pathValue: string) {
  const normalizedPath = pathValue.replaceAll("\\", "/");
  return normalizedPath.startsWith("./") ? normalizedPath.slice(2) : normalizedPath;
}

async function rgFiles(
  projectPath: string,
  globTargets: string[],
  signal?: AbortSignal,
) {
  const args = ["--files", "--hidden"];

  for (const skipped of SKIPPED_DIRECTORIES) {
    args.push("--glob", `!**/${skipped}/**`);
  }
  for (const globTarget of globTargets) {
    args.push("--glob", globTarget);
  }

  args.push(".");
  const commandResult = await runCommand(projectPath, "rg", args, {
    signal,
    successExitCodes: [0, 1],
    abortMessage: "mapper aborted",
  });
  return commandResult.stdout
    .split("\n")
    .map((line) => normalizePath(line.trim()))
    .filter((line) => line.length > 0);
}

async function grepFiles(
  projectPath: string,
  globTargets: string[],
  signal?: AbortSignal,
) {
  const args = ["-r", "-I", "-l"];

  for (const skipped of SKIPPED_DIRECTORIES) {
    args.push("--exclude-dir", skipped);
  }

  args.push("-e", "", ".");
  const commandResult = await runCommand(projectPath, "grep", args, {
    signal,
    successExitCodes: [0, 1],
    abortMessage: "mapper aborted",
  });
  const paths = commandResult.stdout
    .split("\n")
    .map((line) => normalizePath(line.trim()))
    .filter((line) => line.length > 0);
  const matchers = globTargets.map((globTarget) => picomatch(globTarget, { dot: true }));
  return paths.filter((pathValue) => matchers.some((matcher) => matcher(pathValue)));
}

export async function resolveTargetPaths(
  projectPath: string,
  targets: string[],
  signal?: AbortSignal,
) {
  const globTargets = targets.flatMap((target) => {
    const normalized = normalizePath(target);
    if (normalized.length === 0) return [];
    if (normalized === ".") return ["**"];
    if (/[*?[\]{}]/.test(normalized)) return [normalized];
    return [normalized, `${normalized}/**`];
  });

  if (globTargets.length === 0) return [];

  try {
    const paths = await rgFiles(projectPath, globTargets, signal);
    return [...new Set(paths)].sort();
  } catch (rgError) {
    const rgMessage = rgError instanceof Error ? rgError.message : String(rgError);
    if (rgMessage === "mapper aborted") {
      throw rgError;
    }

    try {
      const paths = await grepFiles(projectPath, globTargets, signal);
      return [...new Set(paths)].sort();
    } catch (grepError) {
      const grepMessage = grepError instanceof Error ? grepError.message : String(grepError);
      throw new Error(`mapper file scan failed: rg=${rgMessage}; grep=${grepMessage}`);
    }
  }
}
