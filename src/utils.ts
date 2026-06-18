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
  checkpoints: "checkpoints.json",
  subsessions: "subsessions.json",
  subsessionsDir: "subsessions",
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

export function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
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

export function isUuid(input: string): boolean {
  const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return pattern.test(input);
}
