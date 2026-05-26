import { homedir } from "node:os";
import { join } from "node:path";

export function getPiLocalPath(cwd: string, ...paths: string[]): string {
  return join(cwd, ".pi", ...paths);
}

export function getPiGlobalPath(...paths: string[]): string {
  return join(homedir(), ".pi", "agent", ...paths);
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
