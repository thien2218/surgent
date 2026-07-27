import { readdir, unlink, readFile, writeFile } from "node:fs/promises";
import path, { dirname, join, resolve } from "node:path";
import { readJson, writeJson } from "../utils.js";
import { fileURLToPath } from "node:url";
import { getPiPath } from "../utils.js";
import type { AgentMeta, Agent, AgentAllowList } from "./types.js";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SUBAGENT } from "../subsession/index.js";
import { loadMcpConfigSet } from "../mcp-client/storage.js";

const FRONTMATTER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const LINE_ENDING = /\r?\n/;
const KEY_VALUE_PAIR = /^(\w+):\s*(.*)$/;
const INLINE_ARRAY = /^\[(.*)\]$/;
const QUOTED_STRING = /^["']|["']$/g;

const ARRAY_KEYS = new Set<keyof AgentMeta>(["tools", "mcp_servers", "skills", "bash", "files"]);
const STRING_KEYS = new Set<keyof AgentMeta>(["description", "model"]);
const META_KEYS: (keyof AgentMeta)[] = [
  "description",
  "tools",
  "mcp_servers",
  "skills",
  "bash",
  "files",
  "model",
];
const META_KEY_SET = new Set<string>(META_KEYS);
const BUILT_IN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "built-in");
const APPEND_PROMPT = resolve(BUILT_IN_DIR, "..", "append.md");
const DEFAULT_AGENT = "default";

function parseAllowList(value: string): AgentAllowList | undefined {
  const inlineArray = value.match(INLINE_ARRAY);
  if (inlineArray) {
    return inlineArray[1]!
      .split(",")
      .map((part) => part.trim().replace(QUOTED_STRING, ""))
      .filter(Boolean);
  }

  const normalized = value.replace(QUOTED_STRING, "").trim();
  if (normalized === "none") return normalized;
  return undefined;
}

function parseAgentConfig(content: string, filePath: string): Agent | null {
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
      const parsed = parseAgentConfig(content, file);
      if (!parsed || (!isBuiltIn(file) && parsed.name === "default")) continue;
      agents.push(parsed);
    } catch {} // skip unreadable files
  }

  if (agents.length === 0) {
    throw new Error("Invalid agent name or files unreachable. Please try again.");
  }

  return agents as [Agent, ...Agent[]];
}

function serializeMeta(meta: AgentMeta): string[] {
  const lines: string[] = [];

  for (const key of META_KEYS) {
    const value = meta[key];
    if (value === undefined) continue;

    if (ARRAY_KEYS.has(key)) {
      const serialized =
        typeof value === "string"
          ? "none"
          : `[${value.map((entry) => JSON.stringify(entry)).join(", ")}]`;
      lines.push(`${key}: ${serialized}`);
      continue;
    }

    lines.push(`${key}: ${String(value)}`);
  }

  return lines;
}

export async function createAgentFile(base: string, name: string): Promise<string> {
  const filePath = join(getPiPath("agents", base), `${name}.md`);
  await writeFile(
    filePath,
    `---\ndescription: Describe what \`${name}\` agent does\n---\n\nWrite \`${name}\` agent's system prompt here`,
    "utf8",
  );
  return filePath;
}

export async function writeAgentMeta(filePath: string, meta: AgentMeta) {
  const content = await readFile(filePath, "utf8");
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

  const nextContent = `---\n${nextFrontmatterLines.join("\n")}\n---\n${body}`;
  await writeFile(filePath, nextContent, "utf8");
}

export async function deleteAgentFiles(name: string, cwd: string) {
  const files = await getAgentFiles(cwd, name, true);
  for (const file of files) {
    try {
      const content = await readFile(file, "utf8");
      const parsed = parseAgentConfig(content, file);
      if (parsed?.name === name) await unlink(file);
    } catch {} // skip
  }
}

export function isBuiltIn(filePath: string): boolean {
  return filePath.startsWith(BUILT_IN_DIR);
}

export async function writeSessionAgent(cwd: string, sessionId: string, agent: string) {
  const file = await readJson<Record<string, string>>(getPiPath("sessionAgents", cwd), {});
  if (agent !== DEFAULT_AGENT) file[sessionId] = agent;
  await writeJson(getPiPath("sessionAgents", cwd), file);
}

export async function loadMainAgent(pi: ExtensionAPI, ctx: ExtensionContext) {
  const file = await readJson<Record<string, string>>(getPiPath("sessionAgents", ctx.cwd), {});
  const name = file[ctx.sessionManager.getSessionId()] ?? SUBAGENT ?? DEFAULT_AGENT;
  ctx.ui.setStatus("agent", ctx.ui.theme.fg("dim", `agent: ${name}`));

  const allMcpConfigs = await loadMcpConfigSet(ctx.cwd);
  const available = {
    tools: pi.getAllTools().map((tool) => tool.name),
    mcp: allMcpConfigs.filter((cfg) => cfg.enabled === true),
  };

  const [agent] = await loadAgents(ctx.cwd, name);
  const { meta, body } = agent;

  pi.setActiveTools(
    available.tools.filter(
      (name) => meta.tools !== "none" && (meta.tools ?? [name]).includes(name),
    ),
  );

  if (meta.model) {
    const existing = ctx.modelRegistry.getAll().find((item) => meta.model?.endsWith(item.id));
    if (existing) {
      const ok = pi.setModel(existing);
      if (!ok) ctx.ui.notify("Agent model unavailable", "warning");
    } else {
      ctx.ui.notify(`Unknown model "${meta.model}" in agent config`, "warning");
    }
  }

  const lines = available.mcp
    .filter(
      (cfg) => meta.mcp_servers !== "none" && (meta.mcp_servers ?? [cfg.name]).includes(cfg.name),
    )
    .map((cfg) => (cfg.description ? `- ${cfg.name} - ${cfg.description}` : `- ${cfg.name}`));
  const sharedInstructions = await readFile(APPEND_PROMPT, "utf8");
  const appendContent = [
    sharedInstructions,
    lines.length > 0 ? `## Enabled MCP Servers\n${lines.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  await writeFile(getPiPath("appendSystem", ctx.cwd), appendContent, "utf8");
  await writeFile(getPiPath("system"), body, "utf8");
  return meta;
}
