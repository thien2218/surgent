import { homedir } from "node:os";
import { join } from "node:path";
import { Text } from "@earendil-works/pi-tui";

const PI_PATHS = {
  web: "web-results",
  agents: "agents",
  settings: "settings.json",
  mcp: "mcp.json",
  permissions: "permissions.json",
  system: "SYSTEM.md",
} as const;

type PiPathKey = keyof typeof PI_PATHS;

export function getPiPath(key: PiPathKey, scope: "global", ...path: string[]): string;
export function getPiPath(key: PiPathKey, cwd: string, ...path: string[]): string;
export function getPiPath(key: PiPathKey): string;
export function getPiPath(key: PiPathKey, ...full: string[]): string {
  const path = PI_PATHS[key];
  const remaining = path.includes(".") ? [] : full.slice(1);
  const baseDir = full[0] === "global" ? homedir() : (full[0] ?? homedir());
  return join(baseDir, ".pi", path, ...remaining);
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

export function customText(text: string, pad: { x?: number; y?: number } = { x: 0, y: 0 }) {
  return new Text(text, pad.x, pad.y);
}
