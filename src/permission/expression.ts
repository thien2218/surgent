import type { PermissiveToolName } from "./types.js";

// A token is "stable" if it is a flag (-f, --flag) or a pure subcommand-like word.
// Paths, quoted strings, filenames, version numbers, etc. are variable.
function isStableToken(token: string): boolean {
  if (token.startsWith("-")) return true;
  return /^[a-z][a-z-]*$/.test(token);
}

function statementToExpr(statement: string): string {
  const tokens = statement.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return statement;

  // Always keep token[0] (the command); find the first variable token among the rest.
  const splitIdx = tokens.findIndex((t, i) => i > 0 && !isStableToken(t));
  if (splitIdx === -1) return tokens.join(" ");

  return `${tokens.slice(0, splitIdx).join(" ")} *`;
}

export function filePathToExpr(path: string): string {
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

export function bashToExpr(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return "";

  // Split on operators while preserving them, then convert each statement independently.
  const parts = trimmed.split(/(\s*(?:&&|\|\||;|\|)\s*)/);
  return parts.map((part, i) => (i % 2 === 0 ? statementToExpr(part) : part)).join("");
}

export function urlToExpr(url: string): string {
  if (!url) return "";
  try {
    const { origin } = new URL(url);
    return `${origin}*`;
  } catch {
    return url;
  }
}

export function toPermExpr(toolName: PermissiveToolName, input: string): string {
  switch (toolName) {
    case "read":
    case "write":
    case "edit":
      return filePathToExpr(input);
    case "bash":
      return bashToExpr(input);
    case "web_fetch":
      return urlToExpr(input);
  }
}
