import { bashToPattern } from "./bash.js";
import type { PermissiveToolName } from "./types.js";

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

export { bashToPattern } from "./bash.js";

export function urlToPattern(url: string): string {
  if (!url) return "";
  try {
    const { origin } = new URL(url);
    return `${origin}/**`;
  } catch {
    return url;
  }
}

export function toPermPattern(toolName: PermissiveToolName, input: string): string {
  if (toolName === "bash") return bashToPattern(input);

  const firstLine = input.replace(/\r\n?/g, "\n").split("\n")[0] ?? "";
  switch (toolName) {
    case "read":
    case "write":
    case "edit":
      return filePathToPattern(firstLine);
    case "web_fetch":
      return urlToPattern(firstLine);
  }
}
