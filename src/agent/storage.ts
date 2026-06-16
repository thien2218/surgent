import { readdir, unlink, readFile, writeFile, mkdir } from "node:fs/promises";
import path, { dirname, join, resolve } from "node:path";
import { readJson, writeJson } from "../utils.js";
import { fileURLToPath } from "node:url";
import { getPiPath } from "../utils.js";
import type { AgentMeta, Agent, AgentAllowList } from "./types.js";

const FRONTMATTER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const LINE_ENDING = /\r?\n/;
const KEY_VALUE_PAIR = /^(\w+):\s*(.*)$/;
const INLINE_ARRAY = /^\[(.*)\]$/;
const QUOTED_STRING = /^["']|["']$/g;

const ARRAY_KEYS = new Set<keyof AgentMeta>(["tools", "mcp_servers", "skills", "bash", "files"]);
const STRING_KEYS = new Set<keyof AgentMeta>(["description", "model"]);
const BUILT_IN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "built-in");

function parseAllowList(value: string): AgentAllowList | undefined {
  const inlineArray = value.match(INLINE_ARRAY);
  if (inlineArray) {
    return inlineArray[1]!
      .split(",")
      .map((part) => part.trim().replace(QUOTED_STRING, ""))
      .filter(Boolean);
  }

  const normalized = value.replace(QUOTED_STRING, "").trim();
  if (normalized === "all") return "all";
  return undefined;
}

function parseFrontmatter(content: string, filePath: string): Agent | null {
  const match = content.match(FRONTMATTER_BLOCK);
  if (!match) return null;

  const frontmatter = match[1]!;
  const body = match[2]!.trim();
  const name = path.basename(filePath, path.extname(filePath));
  const meta: Partial<AgentMeta> = {};

  for (const line of frontmatter.split(LINE_ENDING)) {
    const kv = line.match(KEY_VALUE_PAIR);
    if (!kv) continue;
    const key = kv[1] as keyof AgentMeta;
    const value = kv[2]!.trim();

    if (ARRAY_KEYS.has(key)) {
      const parsedAllowList = parseAllowList(value);
      if (parsedAllowList !== undefined) {
        (meta as Record<string, AgentAllowList>)[key] = parsedAllowList;
      }
    } else if (STRING_KEYS.has(key)) {
      (meta as Record<string, string>)[key] = value.replace(QUOTED_STRING, "");
    }
  }

  if (!meta.description) return null;
  return { meta: meta as AgentMeta, body, filePath, name };
}

async function getAgentFiles(cwd: string, name?: string, skipBuiltIn?: boolean): Promise<string[]> {
  const seen = new Set<string>();
  const dirs = [getPiPath("agents", cwd), getPiPath("agents")];
  const files: string[] = [];
  if (!skipBuiltIn) dirs.push(BUILT_IN_DIR);

  for (const dir of dirs) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      files.push(
        ...entries
          .filter((entry) => {
            if (seen.has(entry.name)) return false;
            seen.add(entry.name);
            return (
              entry.isFile() && entry.name.endsWith(".md") && (!name || entry.name === `${name}.md`)
            );
          })
          .map((entry) => join(dir, entry.name)),
      );
    } catch {
      continue;
    }
  }

  return files;
}

export async function loadAgents(cwd: string, name?: string): Promise<[Agent, ...Agent[]]> {
  const agents: Agent[] = [];
  const files = await getAgentFiles(cwd, name);

  for (const file of files) {
    try {
      const content = await readFile(file, "utf8");
      const parsed = parseFrontmatter(content, file);
      if (!parsed || (!isBuiltIn(file) && parsed.name === "default")) continue;
      agents.push(parsed);
    } catch {} // skip unreadable files
  }

  if (agents.length === 0) {
    throw new Error("Invalid agent name or files unreachable. Please try again.");
  }

  return agents as [Agent, ...Agent[]];
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
  const files = await getAgentFiles(cwd, name, true);
  for (const file of files) {
    try {
      const content = await readFile(file, "utf8");
      const parsed = parseFrontmatter(content, file);
      if (parsed?.name === name) await unlink(file);
    } catch {} // skip
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
  const filePath = getPiPath(type, cwd ?? "");
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, prompt, "utf8");
}

export async function writeSessionAgent(
  cwd: string,
  sessionId: string,
  agent: string,
): Promise<void> {
  const file = await readJson<Record<string, string>>(getPiPath("sessionAgents", cwd), {});
  if (agent !== "default") file[sessionId] = agent;
  await writeJson(getPiPath("sessionAgents", cwd), file);
}
