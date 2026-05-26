export interface AgentMeta {
  name: string;
  description: string;
  tools?: string[];
  mcp_servers?: string[];
  subagents?: string[];
  skills?: string[];
  bash?: string[];
  files?: string[];
  model?: string;
}

export interface ParsedAgent {
  meta: AgentMeta;
  body: string;
  filePath: string;
}

const FRONTMATTER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const LINE_ENDING = /\r?\n/;
const KEY_VALUE_PAIR = /^(\w+):\s*(.*)$/;
const INLINE_ARRAY = /^\[(.+)\]$/;
const QUOTED_STRING = /^["']|["']$/g;

const ARRAY_KEYS = new Set(["tools", "mcp_servers", "subagents", "skills", "bash", "files"]);
const STRING_KEYS = new Set(["name", "description", "model"]);

export function parseFrontmatter(content: string, filePath: string): ParsedAgent | null {
  const match = content.match(FRONTMATTER_BLOCK);
  if (!match) return null;

  const frontmatter = match[1]!;
  const body = match[2]!.trim();
  const meta: Partial<AgentMeta> = {};

  for (const line of frontmatter.split(LINE_ENDING)) {
    const kv = line.match(KEY_VALUE_PAIR);
    if (!kv) continue;
    const key = kv[1] as keyof AgentMeta;
    const value = kv[2]!.trim();

    if (ARRAY_KEYS.has(key)) {
      const inlineArray = value.match(INLINE_ARRAY);
      if (inlineArray) {
        (meta as Record<string, string[]>)[key] = inlineArray[1]!
          .split(",")
          .map((part) => part.trim().replace(QUOTED_STRING, ""))
          .filter(Boolean);
      }
    } else if (STRING_KEYS.has(key)) {
      (meta as Record<string, string>)[key] = value.replace(QUOTED_STRING, "");
    }
  }

  if (!meta.name || !meta.description) return null;
  return { meta: meta as AgentMeta, body, filePath };
}
