import { BASH_TOKEN } from "./constants.js";
import type { PermissiveToolName } from "./types.js";

// A token is "stable" if it is a flag (-f, --flag) or a pure subcommand-like word.
// Paths, quoted strings, filenames, version numbers, etc. are variable.
function isStableToken(token: string): boolean {
  if (token.startsWith("-")) return true;
  return /^[a-z][a-z-]*$/.test(token);
}

function parseBashTopLevel(command: string): { statements: string[]; operators: string[] } {
  const parts = command.match(BASH_TOKEN) ?? [];
  const statements: string[] = [];
  const operators: string[] = [];
  let current = "";

  const pushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed) {
      statements.push(trimmed);
    }
    current = "";
  };

  for (const part of parts) {
    if (part === "&&" || part === "||" || part === "|" || part === ";" || part === "&") {
      pushCurrent();
      operators.push(part);
      continue;
    }
    current += (current ? " " : "") + part;
  }

  pushCurrent();
  return { statements, operators };
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

function statementToExpr(statement: string): string {
  const tokens = statement.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return statement;

  const splitIdx = tokens.findIndex((token, idx) => idx > 0 && !isStableToken(token));
  if (splitIdx === -1) return tokens.join(" ");

  return `${tokens.slice(0, splitIdx).join(" ")} *`;
}

export function bashToExpr(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return "";

  const { statements, operators } = parseBashTopLevel(trimmed);
  if (statements.length === 0) return "";

  let expression = statementToExpr(statements[0]!);
  for (let idx = 1; idx < statements.length; idx += 1) {
    expression += ` ${operators[idx - 1] ?? "|"} ${statementToExpr(statements[idx]!)}`;
  }

  return expression;
}

export function urlToExpr(url: string): string {
  if (!url) return "";
  try {
    const { origin } = new URL(url);
    return `${origin}/**`;
  } catch {
    return url;
  }
}

export function toPermExpr(toolName: PermissiveToolName, input: string): string {
  const firstLine = input.replace(/\r\n?/g, "\n").split("\n")[0] ?? "";

  switch (toolName) {
    case "read":
    case "write":
    case "edit":
      return filePathToExpr(firstLine);
    case "bash":
      return bashToExpr(firstLine);
    case "web_fetch":
      return urlToExpr(firstLine);
  }
}
