import { readdir, unlink, readFile, writeFile } from "node:fs/promises";
import path, { dirname, join, resolve } from "node:path";
import { isMissingFileError, readJson, writeJson } from "../utils.js";
import { fileURLToPath } from "node:url";
import { getPiPath } from "../utils.js";
import type { AgentMeta, Agent, AgentProfile, SettingsSchema } from "./types.js";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadMcpConfigs } from "../mcp-client/storage.js";

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
const BUILT_IN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "built-in");

export function parseAgentList(field: keyof AgentMeta, value: string): string[] {
  try {
    const inlineArray = value.match(INLINE_ARRAY);
    if (!inlineArray) throw new Error();
    let entries: unknown;
      entries = inlineArray[1]!.trim()
        ? inlineArray[1]!.split(",").map((entry) => {
            const trimmed = entry.trim();
            if (!/^(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\s,'"\[\]{}]+)$/.test(trimmed)) throw new Error();
            return trimmed.startsWith('"')
              ? JSON.parse(trimmed)
              : trimmed.replace(QUOTED_STRING, "");
          })
        : [];
    if (!Array.isArray(entries) || !entries.every((entry) => typeof entry === "string")) {
      throw new Error();
    }
    return entries;
  } catch {
    throw new Error(
      `${field} must be an inline array of strings.`,
    );
  }
}

function validateAgentMeta(meta: AgentMeta) {
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

}

function parseAgentConfig(content: string, filePath: string): Agent {
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
            if (
              !entry.isFile() ||
              !entry.name.endsWith(".md") ||
              (name && entry.name !== `${name}.md`)
            ) {
              return false;
            }
            if (seen.has(entry.name)) return false;
            seen.add(entry.name);
            return true;
          })
          .map((entry) => join(dir, entry.name)),
      );
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
  }

  return files;
}

async function appendToolDetails(activeTools: string[], lines: Record<string, string>) {
  const appendContent: string[] = [];
  if (
    (activeTools.includes("call_mcp_tool") || activeTools.includes("list_mcp_tools")) &&
    lines.mcp
  ) {
    appendContent.push(lines.mcp);
  }
  if (activeTools.includes("subagent") && lines.subagent) {
    appendContent.push(lines.subagent);
  }
  if (appendContent.length > 0) {
    await writeFile(getPiPath("system"), `${appendContent.join("\n")}\n`, "utf8");
  }
}

export async function loadAgentProfiles(cwd: string, name?: string): Promise<AgentProfile[]> {
  const profiles: AgentProfile[] = [];
  const files = await getAgentFiles(cwd, name);
  const settings = await readJson<SettingsSchema>(getPiPath("settings"), {});

  for (const filePath of files) {
    const profile = {
      name: path.basename(filePath, ".md"),
      filePath,
      scope: isBuiltIn(filePath)
        ? ("built-in" as const)
        : dirname(filePath) === getPiPath("agents", cwd)
          ? ("local" as const)
          : ("global" as const),
    };

    try {
      const agent = parseAgentConfig(await readFile(filePath, "utf8"), filePath);
      if (!isBuiltIn(filePath) && agent.name === DEFAULT_AGENT) continue;
      if (isBuiltIn(filePath)) {
        agent.meta = { ...agent.meta, ...settings.agent?.meta?.[agent.name] };
        validateAgentMeta(agent.meta);
      }
      profiles.push({ ...profile, agent });
    } catch (error) {
      profiles.push({ ...profile, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return profiles;
}

export async function loadAgents(cwd: string, name?: string): Promise<[Agent, ...Agent[]]> {
  const profiles = await loadAgentProfiles(cwd, name);
  const invalid = profiles.find((profile) => profile.error !== undefined);
  if (name && invalid) throw new Error(`Invalid agent "${name}": ${invalid.error}`);
  const agents = profiles.flatMap((profile) => (profile.agent ? [profile.agent] : []));
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

    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map((entry) => JSON.stringify(entry)).join(", ")}]`);
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

export async function writeAgentMeta(agent: Agent, meta: AgentMeta) {
  validateAgentMeta(meta);
  if (isBuiltIn(agent.filePath)) {
    const settingsPath = getPiPath("settings");
    let settings: SettingsSchema;
    try {
      settings = JSON.parse(await readFile(settingsPath, "utf8")) as SettingsSchema;
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
      settings = {};
    }

    const { description, ...stored } = meta;
    settings.agent = {
      ...settings.agent,
      meta: { ...settings.agent?.meta, [agent.name]: stored },
    };
    await writeJson(settingsPath, settings);
    return;
  }

  const content = await readFile(agent.filePath, "utf8");
  const match = content.match(FRONTMATTER_BLOCK);
  if (!match) {
    throw new Error(`Invalid agent file frontmatter: ${agent.filePath}`);
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
  await writeFile(agent.filePath, nextContent, "utf8");
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

export async function loadMainAgent(pi: ExtensionAPI, ctx: ExtensionContext) {
  const selected = ctx.sessionManager
    .getEntries()
    .find((entry) => entry.type === "custom" && entry.customType === "agent");
  const name = selected?.type === "custom" ? (selected.data as string) : DEFAULT_AGENT;
  const [mcpConfigs, profiles] = await Promise.all([
    loadMcpConfigs(ctx.cwd),
    loadAgentProfiles(ctx.cwd),
  ]);
  const profile = profiles.find((profile) => profile.name === name);
  if (!profile) throw new Error("Invalid agent name.");
  if (!profile.agent) throw new Error(`Invalid agent "${name}": ${profile.error}`);

  const agents = profiles.flatMap((profile) => (profile.agent ? [profile.agent] : []));
  const { meta } = profile.agent;
  pi.setActiveTools(
    pi
      .getAllTools()
      .map((tool) => tool.name)
      .filter((name) => (meta.tools ?? [name]).includes(name)),
  );

  if (meta.model) {
    const existing = ctx.modelRegistry.find(
      meta.model.slice(0, meta.model.indexOf("/")),
      meta.model.slice(meta.model.indexOf("/") + 1),
    );

    if (existing) {
      const ok = await pi.setModel(existing);
      if (!ok) ctx.ui.notify("Agent model unavailable", "warning");
    } else {
      ctx.ui.notify(`Unknown model "${meta.model}" in agent config`, "warning");
    }
  }
  if (meta.thinking_level) {
    pi.setThinkingLevel(meta.thinking_level);
  }

  await appendToolDetails(pi.getActiveTools(), {
    mcp: `## Available MCP servers\n${mcpConfigs
      .filter((cfg) => cfg.enabled === true && (meta.mcp_tools ?? [cfg.name]).includes(cfg.name))
      .map((cfg) => (cfg.description ? `- ${cfg.name}: ${cfg.description}` : `- ${cfg.name}`))
      .join("\n")}`,
    subagent: `## Available agents for 'subagent' tool\n${agents
      .filter(({ name }) => name !== DEFAULT_AGENT)
      .map((profile) => `- ${profile.name}: ${profile.meta.description}`)
      .join("\n")}`,
  });
  return profile.agent;
}
