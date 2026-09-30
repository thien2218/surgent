import path from "node:path";
import type { Agent, AgentMeta } from "./types.js";

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export const DEFAULT_AGENT = "general";

export const META_KEYS: (keyof AgentMeta)[] = [
  "description",
  "tools",
  "mcp_tools",
  "skills",
  "bash",
  "files.read",
  "files.write",
  "model",
  "thinking_level",
];

const FRONTMATTER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

const LINE_ENDING = /\r?\n/;

const KEY_VALUE_PAIR = /^([\w.]+):\s*(.*)$/;

const INLINE_ARRAY = /^\[(.*)\]$/;

const QUOTED_STRING = /^["']|["']$/g;

const ARRAY_KEYS = new Set<keyof AgentMeta>([
  "tools",
  "mcp_tools",
  "skills",
  "bash",
  "files.read",
  "files.write",
]);

const STRING_KEYS = new Set<keyof AgentMeta>(["description", "model", "thinking_level"]);

const META_KEY_SET = new Set<string>(META_KEYS);

export function parseAgentList(field: keyof AgentMeta, value: string): string[] {
  const quoted = field === "bash" || field === "files.read" || field === "files.write";
  try {
    const inlineArray = value.match(INLINE_ARRAY);
    if (!inlineArray) throw new Error();
    let entries: unknown;
    if (quoted) {
      entries = JSON.parse(value);
    } else {
      entries = inlineArray[1]!.trim()
        ? inlineArray[1]!.split(",").map((entry) => {
            const trimmed = entry.trim();
            if (!/^(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\s,'"\[\]{}]+)$/.test(trimmed)) throw new Error();
            return trimmed.startsWith('"')
              ? JSON.parse(trimmed)
              : trimmed.replace(QUOTED_STRING, "");
          })
        : [];
    }
    if (!Array.isArray(entries) || !entries.every((entry) => typeof entry === "string")) {
      throw new Error();
    }
    return field.startsWith("files.")
      ? entries.map((entry: string) => entry.replace(/\\/g, "/"))
      : entries;
  } catch {
    throw new Error(
      `${field} must be an inline array${quoted ? " of double-quoted strings" : " of strings"}.`,
    );
  }
}

export function validateAgentMeta(meta: AgentMeta) {
  if (typeof meta.description !== "string" || !meta.description.trim()) {
    throw new Error("Description cannot be empty.");
  }
  for (const field of ARRAY_KEYS) {
    const value = meta[field];
    if (
      value !== undefined &&
      (!Array.isArray(value) || !value.every((entry) => typeof entry === "string"))
    ) {
      throw new Error(`${field} must be an array of strings.`);
    }
  }
  for (const field of STRING_KEYS) {
    if (meta[field] !== undefined && typeof meta[field] !== "string") {
      throw new Error(`${field} must be a string.`);
    }
  }
  if (meta.thinking_level !== undefined && !THINKING_LEVELS.includes(meta.thinking_level)) {
    throw new Error(`Thinking level must be ${THINKING_LEVELS.join(", ")}.`);
  }
  for (const field of ["files.read", "files.write"] as const) {
    if (meta[field]) meta[field] = meta[field].map((entry) => entry.replace(/\\/g, "/"));
  }
}

export function parseAgentConfig(content: string, filePath: string): Agent {
  const match = content.match(FRONTMATTER_BLOCK);
  if (!match) throw new Error("Missing or invalid agent frontmatter.");

  const frontmatter = match[1]!;
  const body = match[2]!.trim();
  const name = path.basename(filePath, path.extname(filePath));
  const meta: Partial<AgentMeta> = {};

  for (const line of frontmatter.split(LINE_ENDING)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const kv = line.match(KEY_VALUE_PAIR);
    if (!kv) throw new Error(`Invalid metadata line: ${line.trim()}`);
    const key = kv[1]!;
    const value = kv[2]!.trim();

    if (ARRAY_KEYS.has(key as keyof AgentMeta)) {
      (meta as Record<string, string[]>)[key] = parseAgentList(key as keyof AgentMeta, value);
    } else if (STRING_KEYS.has(key as keyof AgentMeta)) {
      (meta as Record<string, string>)[key] = value.replace(QUOTED_STRING, "");
    }
  }

  validateAgentMeta(meta as AgentMeta);
  return { meta: meta as AgentMeta, body, filePath, name };
}

function serializeMeta(meta: AgentMeta): string[] {
  const lines: string[] = [];

  for (const key of META_KEYS) {
    const value = meta[key];
    if (value === undefined) continue;

    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map((entry) => JSON.stringify(entry)).join(", ")}]`);
      continue;
    }

    lines.push(`${key}: ${String(value)}`);
  }

  return lines;
}

export function validateAgentName(name: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) {
    throw new Error(
      "Agent name must start with a letter or digit and contain only ASCII letters, digits, hyphens, or underscores.",
    );
  }
}

export function serializeAgentConfig(content: string, meta: AgentMeta, filePath: string): string {
  const match = content.match(FRONTMATTER_BLOCK);
  if (!match) {
    throw new Error(`Invalid agent file frontmatter: ${filePath}`);
  }

  const existingFrontmatter = match[1] ?? "";
  const preservedFrontmatterLines = existingFrontmatter
    .split(LINE_ENDING)
    .map((line) => line.trimEnd())
    .filter((line) => {
      const pair = line.match(KEY_VALUE_PAIR);
      if (!pair) {
        return line.trim().length > 0;
      }
      return !META_KEY_SET.has(pair[1]!);
    });

  const body = match[2] ?? "";
  const metaLines = serializeMeta(meta);
  const nextFrontmatterLines = [...preservedFrontmatterLines, ...metaLines];

  return `---\n${nextFrontmatterLines.join("\n")}\n---\n${body}`;
}
