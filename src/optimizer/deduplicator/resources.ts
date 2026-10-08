import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseInspectToolDetails } from "../inspector/helpers.js";

export function normalizeResourcePath(sourcePath: string, cwd: string): string {
  const absolutePath = resolve(cwd, sourcePath);
  try {
    return normalize(realpathSync(absolutePath));
  } catch {
    return normalize(absolutePath);
  }
}

// Mirror Pi's built-in input conventions without importing private modules.
export function normalizeToolPath(sourcePath: string, cwd: string, tool: "read" | "write"): string {
  let path = sourcePath.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ");
  if (path.startsWith("@")) path = path.slice(1);
  if (process.platform === "win32" && path.startsWith("/") && !path.startsWith("//") && !path.includes("\\")) {
    const drive = path.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i);
    if (drive) path = `${drive[1]!.toUpperCase()}:\\${drive[2]?.replaceAll("/", "\\") ?? ""}`;
  }
  if (path === "~") path = homedir();
  else if (path.startsWith("~/") || (process.platform === "win32" && path.startsWith("~\\"))) {
    path = join(homedir(), path.slice(2));
  }
  if (path.startsWith("file://")) path = fileURLToPath(path);
  path = resolve(cwd, path);

  if (tool === "read") {
    const decomposed = path.normalize("NFD");
    const candidates = [
      path,
      path.replace(/ (AM|PM)\./gi, "\u202f$1."),
      decomposed,
      path.replace(/'/g, "\u2019"),
      decomposed.replace(/'/g, "\u2019"),
    ];
    path = candidates.find(existsSync) ?? path;
  }
  return normalizeResourcePath(path, cwd);
}

export function getInspectIdentity(details: unknown, cwd: string): { path: string; symbol: string } | undefined {
  const inspected = parseInspectToolDetails(details);
  if (!inspected) return;
  return { path: normalizeResourcePath(inspected.path, cwd), symbol: inspected.symbol };
}
