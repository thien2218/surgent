import { readdir, unlink, readFile, writeFile } from "node:fs/promises";
import path, { dirname, join, resolve } from "node:path";
import { isMissingFileError, readJson, writeJson } from "../utils.js";
import { fileURLToPath } from "node:url";
import { getPiPath } from "../utils.js";
import type { AgentMeta, Agent, AgentProfile, SettingsSchema } from "./types.js";
import {
  parseAgentConfig,
  serializeAgentConfig,
  validateAgentMeta,
  validateAgentName,
} from "./config.js";
const BUILT_IN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "built-in");

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
