import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readdir, unlink, readFile, writeFile } from "node:fs/promises";
import path, { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMissingFileError, readJson, writeJson, getPiPath } from "../utils.js";
import type { AgentMeta, Agent, AgentProfile, SettingsSchema } from "./types.js";
import {
  DEFAULT_AGENT,
  parseAgentConfig,
  serializeAgentConfig,
  validateAgentMeta,
  validateAgentName,
} from "./config.js";

const BUILT_IN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "built-in");
const BASE_PROMPT = `
<optimization priority="highest" target="token usage">
1. Token consumption by read-only tools in asc order: 'ls' → 'find' → 'grep' → 'code_map' → 'inspect' → 'read'. Use the right tool for the right purpose.
2. Load applicable skills, instructions, and reference docs once. "Use/read before work" means apply already-loaded content, not reload it per task.
3. Re-read content only with evidence of file changes or required content truncated or unavailable. Identify the gap first; fetch only the changed/missing region. Do NOT run freshness checks solely to justify re-reading.
4. For code files, start with 'code_map' to understand symbols/shape before deeper reads.
5. Use 'inspect' for minimal symbol body needed to answer/fix.
6. Use 'read' on code only when region is uninspectable.
7. 'read' on code MUST have offset + limit. ALWAYS use range from 'code_map' output as the source of truth.
</optimization>
`;

async function getAgentFiles(cwd: string, name?: string): Promise<string[]> {
  const seen = new Set<string>();
  const dirs = [getPiPath("agents", cwd), getPiPath("agents"), BUILT_IN_DIR];
  const files: string[] = [];

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

export async function createAgentFile(base: string, name: string): Promise<string> {
  validateAgentName(name);
  const filePath = join(getPiPath("agents", base), `${name}.md`);
  try {
    await writeFile(
      filePath,
      `---\ndescription: Describe what \`${name}\` agent does\n---\n\nWrite \`${name}\` agent's system prompt here`,
      { encoding: "utf8", flag: "wx" },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Agent "${name}" already exists in selected scope.`);
    }
    throw error;
  }
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
  await writeFile(agent.filePath, serializeAgentConfig(content, meta, agent.filePath), "utf8");
}

export async function deleteAgentFile(filePath: string) {
  if (isBuiltIn(filePath)) throw new Error("Built-in agent cannot be deleted.");
  await unlink(filePath);
}

export function isBuiltIn(filePath: string): boolean {
  return filePath.startsWith(BUILT_IN_DIR);
}

export async function loadMainAgent(pi: ExtensionAPI, ctx: ExtensionContext) {
  const selected = ctx.sessionManager
    .getEntries()
    .find((entry) => entry.type === "custom" && entry.customType === "agent");
  const name = selected?.type === "custom" ? (selected.data as string) : DEFAULT_AGENT;
  const profiles = await loadAgentProfiles(ctx.cwd);
  const profile = profiles.find((profile) => profile.name === name);
  if (!profile) throw new Error("Invalid agent name.");
  if (!profile.agent) throw new Error(`Invalid agent "${name}": ${profile.error}`);

  const agents = profiles.flatMap((profile) => (profile.agent ? [profile.agent] : []));
  const { meta } = profile.agent;
  // Registry includes deferred/codemode tools; only explicit choices promote them.
  if (meta.tools) pi.setActiveTools(meta.tools);

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

  let systemPrompt = BASE_PROMPT;
  if (pi.getActiveTools().includes("subagent")) {
    const subagentsList = agents
      .filter(({ name }) => name !== DEFAULT_AGENT)
      .map((profile) => `- ${profile.name}: ${profile.meta.description}`)
      .join("\n");
    systemPrompt += `\n\n<subagents>\n${subagentsList}\n</subagents>`;
  }
  await writeFile(getPiPath("system"), systemPrompt, "utf8");
  return profile.agent;
}
