import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Text } from "@earendil-works/pi-tui";

const PI_PATHS = {
  web: "web-results",
  agents: "agents",
  settings: "settings.json",
  mcp: "mcp.json",
  permissions: "permissions.json",
  sessionAgents: "agents.json",
  checkpoints: "checkpoints",
  subsessions: "subsessions.json",
  subsessionsDir: "subsessions",
  grammars: "grammars",
  system: "SYSTEM.md",
  appendSystem: "APPEND_SYSTEM.md",
} as const;

type PathKey = keyof typeof PI_PATHS;

export function getPiPath(key: PathKey, scope: "global", ...path: string[]): string;
export function getPiPath(key: PathKey, cwd: string, ...path: string[]): string;
export function getPiPath(key: PathKey): string;
export function getPiPath(key: PathKey, ...full: string[]): string {
  const path = PI_PATHS[key];
  const remaining = path.includes(".") ? [] : full.slice(1);
  const isGlobal = !full[0] || full[0] === "global";
  const baseDir = isGlobal ? homedir() : full[0]!;
  const piPath = isGlobal ? [".pi", "agent"] : [".pi"];
  return join(baseDir, ...piPath, path, ...remaining);
}

export async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson(filePath: string, data: unknown) {
  await writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export async function runCommand(
  cwd: string,
  command: string,
  argumentsList: string[],
  options?: { signal?: AbortSignal; successExitCodes?: number[]; abortMessage?: string },
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const abortMessage = options?.abortMessage ?? "command aborted";
  if (options?.signal?.aborted) {
    throw new Error(abortMessage);
  }

  return await new Promise<{ stdout: string; stderr: string; exitCode: number | null }>(
    (resolveCommand, rejectCommand) => {
      const executable = process.platform === "win32" ? `${command}.cmd` : command;
      const childProcess = spawn(executable, argumentsList, {
        cwd,
        env: process.env,
        signal: options?.signal,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      childProcess.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      childProcess.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      childProcess.on("error", (error) => {
        rejectCommand(error);
      });

      childProcess.on("close", (exitCode) => {
        if (options?.signal?.aborted) {
          rejectCommand(new Error(abortMessage));
          return;
        }

        const successExitCodes = options?.successExitCodes ?? [0];
        if (!successExitCodes.includes(exitCode ?? -1)) {
          const commandText = `${command} ${argumentsList.join(" ")}`;
          const stderrText = stderr.trim();
          rejectCommand(
            new Error(
              `${commandText} failed with exit code ${exitCode ?? "unknown"}${stderrText ? `: ${stderrText}` : ""}`,
            ),
          );
          return;
        }

        resolveCommand({ stdout, stderr, exitCode });
      });
    },
  );
}

export function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function tokenizeArgs(args: string): string[] {
  return args
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function customText(text: string, pad?: { x?: number; y?: number }) {
  const { x = 0, y = 0 } = pad ?? {};
  return new Text(text, x, y);
}

export function isMissingFileError(error: any) {
  return Boolean(error) && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

export function isUuidv7(input: string): boolean {
  const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return pattern.test(input);
}
