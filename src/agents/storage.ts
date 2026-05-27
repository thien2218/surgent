import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getPiGlobalPath, getPiLocalPath } from "../utils.js";
import { type ParsedAgent, parseFrontmatter } from "./parser.js";

const BUILT_IN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "built-in");
const AGENTS_DIR = "agents";
const GLOBAL_AGENTS_DIR = getPiGlobalPath(AGENTS_DIR);
export const AGENT_PROMPT_DIR = getPiGlobalPath("agent-prompt");

async function readAgentsFromDir(dir: string, skipDefault: boolean): Promise<ParsedAgent[]> {
  let files: string[];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name);
  } catch {
    return [];
  }

  const agents: ParsedAgent[] = [];
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

export async function loadAgents(cwd: string): Promise<ParsedAgent[]> {
  const seen = new Set<string>();
  const result: ParsedAgent[] = [];

  const add = (agents: ParsedAgent[]) => {
    for (const agent of agents) {
      if (!seen.has(agent.meta.name)) {
        seen.add(agent.meta.name);
        result.push(agent);
      }
    }
  };

  add(await readAgentsFromDir(getPiLocalPath(cwd, AGENTS_DIR), true));
  add(await readAgentsFromDir(GLOBAL_AGENTS_DIR, true));
  add(await readAgentsFromDir(BUILT_IN_DIR, false));

  return result;
}

export function getAgentDir(scope: "local" | "global", cwd: string): string {
  return scope === "local" ? getPiLocalPath(cwd, AGENTS_DIR) : GLOBAL_AGENTS_DIR;
}

export async function createAgentFile(
  name: string,
  scope: "local" | "global",
  cwd: string,
): Promise<string> {
  const dir = getAgentDir(scope, cwd);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${name}.md`);
  await writeFile(filePath, `---\nname: ${name}\ndescription: \n---\n\n`, "utf8");
  return filePath;
}

export async function deleteAgentFiles(name: string, cwd: string): Promise<void> {
  const dirs = [getPiLocalPath(cwd, AGENTS_DIR), GLOBAL_AGENTS_DIR];
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

export async function writeAgentPrompt(body: string): Promise<void> {
  await mkdir(AGENT_PROMPT_DIR, { recursive: true });
  await writeFile(join(AGENT_PROMPT_DIR), body, "utf8");
}
