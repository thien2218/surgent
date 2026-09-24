import { unique } from "../utils.js";
import { bashToPattern } from "./bash.js";
import type { PermissionCheck } from "./types.js";

export function filePathToPattern(path: string): string {
  if (!path || path.endsWith("/")) return path;

  const lastSlash = path.lastIndexOf("/");
  const dir = lastSlash >= 0 ? path.slice(0, lastSlash + 1) : "";
  const filename = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;

  if (!filename) return path;

  const depth = dir.split("/").filter(Boolean).length;

  if (depth >= 3) return `${dir}**`;

  if (filename.startsWith(".")) {
    const extDot = filename.lastIndexOf(".");
    return extDot > 0 ? `${dir}.*${filename.slice(extDot)}` : `${dir}.*`;
  }

  const extDot = filename.lastIndexOf(".");
  return extDot > 0 ? `${dir}*${filename.slice(extDot)}` : `${dir}*`;
}

export function urlToPattern(url: string): string {
  if (!url) return "";
  try {
    const { origin } = new URL(url);
    return `${origin}/**`;
  } catch {
    return url;
  }
}

export function toPatterns(check: PermissionCheck): string[] {
  switch (check.category) {
    case "file": {
      return [`${check.operation}:${filePathToPattern(check.relative)}`];
    }
    case "web":
      return [urlToPattern(check.raw)];
    case "bash":
      return unique(check.unresolved.map((item) => bashToPattern(item)));
    case "mcp":
      return [check.raw];
  }
}
