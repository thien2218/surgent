import { realpathSync } from "node:fs";
import { normalize, resolve } from "node:path";
import { parseInspectToolDetails } from "../inspector/helpers.js";

function normalizeResourcePath(sourcePath: string, cwd: string): string {
  const absolutePath = resolve(cwd, sourcePath);
  try {
    return normalize(realpathSync(absolutePath));
  } catch {
    return normalize(absolutePath);
  }
}

export function getInspectIdentity(details: unknown, cwd: string): string | undefined {
  const inspected = parseInspectToolDetails(details);
  if (!inspected) return;
  return JSON.stringify([normalizeResourcePath(inspected.path, cwd), inspected.symbol]);
}
