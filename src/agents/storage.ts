import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getPiPath } from "../utils.js";
import type { AgentMeta, Agent } from "./types.js";

const FRONTMATTER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const LINE_ENDING = /\r?\n/;
const KEY_VALUE_PAIR = /^(\w+):\s*(.*)$/;
const INLINE_ARRAY = /^\[(.+)\]$/;
const QUOTED_STRING = /^["']|["']$/g;

const ARRAY_KEYS = new Set<keyof AgentMeta>([
  "tools",
  "mcp_servers",
  "subagents",
  "skills",
  "bash",
  "files",
]);
const STRING_KEYS = new Set<keyof AgentMeta>(["name", "description", "model"]);

const BUILT_IN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "built-in");

async function readAgentsFromDir(dir: string, skipDefault: boolean): Promise<Agent[]> {
  let files: string[];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name);
  } catch {
    return [];
  }

  const agents: Agent[] = [];
  for (const file of files) {
    const filePath = join(dir, file);
    try {
      const content = await readFile(filePath, "utf8");
      const parsed = parseFrontmatter(content, filePath);
      if (!parsed) continue;
      if (skipDefault && parsed.meta.name === "default") continue;
      agents.push(parsed);
    } catch {} // skip unreadable files
  }

  return agents;
}

export async function loadAgents(cwd: string): Promise<Agent[]> {
  const seen = new Set<string>();
  const result: Agent[] = [];

  const add = (agents: Agent[]) => {
    for (const agent of agents) {
      if (!seen.has(agent.meta.name)) {
        seen.add(agent.meta.name);
        result.push(agent);
      }
    }
  };

  add(await readAgentsFromDir(getPiPath("agents", cwd), true));
  add(await readAgentsFromDir(getPiPath("agents"), true));
  add(await readAgentsFromDir(BUILT_IN_DIR, false));

  return result;
}

export async function createAgentFile(name: string, dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${name}.md`);
  await writeFile(
    filePath,
    `---\nname: ${name}\ndescription: \n---\n\nDescribe what '${name}' agent does`,
    "utf8",
  );
  return filePath;
}

export async function deleteAgentFiles(name: string, cwd: string): Promise<void> {
  const dirs = [getPiPath("agents", cwd), getPiPath("agents")];
  for (const dir of dirs) {
    let files: string[];
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      files = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .map((entry) => entry.name);
    } catch {
      continue;
    }

    for (const file of files) {
      const filePath = join(dir, file);
      try {
        const content = await readFile(filePath, "utf8");
        const parsed = parseFrontmatter(content, filePath);
        if (parsed?.meta.name === name) await unlink(filePath);
      } catch {} // skip
    }
  }
}

export function isBuiltIn(filePath: string): boolean {
  return filePath.startsWith(BUILT_IN_DIR);
}

export async function writeAgentPrompt(
  prompt: string,
  type: "appendSystem" | "system",
  cwd?: string,
): Promise<void> {
  await writeFile(getPiPath(type, cwd ?? ""), prompt, "utf8");
}

function parseFrontmatter(content: string, filePath: string): Agent | null {
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
