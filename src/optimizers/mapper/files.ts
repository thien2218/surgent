import { spawn } from "node:child_process";
import picomatch from "picomatch";

const SKIPPED_DIRECTORIES = new Set([".git", ".pi", "build", "coverage", "dist", "node_modules"]);

function normalizePath(pathValue: string) {
  const normalizedPath = pathValue.replaceAll("\\", "/");
  return normalizedPath.startsWith("./") ? normalizedPath.slice(2) : normalizedPath;
}

function applyGlobTargets(paths: string[], globTargets: string[]) {
  if (globTargets.length === 0) {
    return paths;
  }

  const matchers = globTargets.map((globTarget) => picomatch(globTarget, { dot: true }));
  return paths.filter((pathValue) => matchers.some((matcher) => matcher(pathValue)));
}

async function runCommand(
  projectPath: string,
  command: string,
  argumentsList: string[],
  signal: AbortSignal | undefined,
) {
  if (signal?.aborted) {
    throw new Error("mapper aborted");
  }

  const stdout = await new Promise<string>((resolve, reject) => {
    const childProcess = spawn(command, argumentsList, {
      cwd: projectPath,
      signal,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdoutBuffer = "";
    let stderrBuffer = "";

    childProcess.stdout.on("data", (chunk) => {
      stdoutBuffer += String(chunk);
    });

    childProcess.stderr.on("data", (chunk) => {
      stderrBuffer += String(chunk);
    });

    childProcess.on("error", reject);

    childProcess.on("close", (code) => {
      if (signal?.aborted) {
        reject(new Error("mapper aborted"));
        return;
      }

      if (code !== 0 && code !== 1) {
        const failureMessage = stderrBuffer.trim();
        reject(
          new Error(
            failureMessage.length > 0 ? failureMessage : `${command} exited with code ${code}`,
          ),
        );
        return;
      }

      resolve(stdoutBuffer);
    });
  });

  return stdout
    .split("\n")
    .map((line) => normalizePath(line.trim()))
    .filter((line) => line.length > 0);
}

async function rgFiles(
  projectPath: string,
  globTargets: string[],
  extensionsSet: Set<string>,
  signal: AbortSignal | undefined,
) {
  const args = ["--files", "--hidden"];

  for (const skippedDirectory of SKIPPED_DIRECTORIES) {
    args.push("--glob", `!**/${skippedDirectory}/**`);
  }

  for (const requestedExtension of extensionsSet) {
    args.push("--glob", `*${requestedExtension}`);
  }

  args.push(".");
  const paths = await runCommand(projectPath, "rg", args, signal);
  return applyGlobTargets(paths, globTargets);
}

async function grepFiles(
  projectPath: string,
  globTargets: string[],
  extensionsSet: Set<string>,
  signal: AbortSignal | undefined,
) {
  const args = ["-r", "-I", "-l"];

  for (const skippedDirectory of SKIPPED_DIRECTORIES) {
    args.push("--exclude-dir", skippedDirectory);
  }

  for (const extension of extensionsSet) {
    args.push("--include", `*${extension}`);
  }

  args.push("-e", "", ".");
  const paths = await runCommand(projectPath, "grep", args, signal);
  return applyGlobTargets(paths, globTargets);
}

export async function resolveTargetPaths(
  projectPath: string,
  targets: string[],
  extensions: string[],
  signal?: AbortSignal,
) {
  const extensionsSet = new Set(extensions.map((extension) => extension.toLowerCase()));
  const globTargets = targets.flatMap((target) => {
    const normalizedTarget = normalizePath(target);
    if (normalizedTarget.length === 0) {
      return [];
    }

    if (normalizedTarget === ".") {
      return ["**"];
    }

    if (/[*?[\]{}]/.test(normalizedTarget)) {
      return [normalizedTarget];
    }

    return [normalizedTarget, `${normalizedTarget}/**`];
  });

  if (globTargets.length === 0) {
    return [];
  }

  try {
    const paths = await rgFiles(projectPath, globTargets, extensionsSet, signal);
    return [...new Set(paths)].sort();
  } catch (rgError) {
    const rgMessage = rgError instanceof Error ? rgError.message : String(rgError);
    if (rgMessage === "mapper aborted") {
      throw rgError;
    }

    try {
      const paths = await grepFiles(projectPath, globTargets, extensionsSet, signal);
      return [...new Set(paths)].sort();
    } catch (grepError) {
      const grepMessage = grepError instanceof Error ? grepError.message : String(grepError);
      throw new Error(`mapper file scan failed: rg=${rgMessage}; grep=${grepMessage}`);
    }
  }
}
