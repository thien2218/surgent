import { writeFile } from "node:fs/promises";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadMcpConfigs } from "../mcp-client/storage.js";
import { getPiPath } from "../utils.js";
import { DEFAULT_AGENT } from "./config.js";
import { loadAgentProfiles } from "./storage.js";

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
  await writeFile(
    getPiPath("system"),
    appendContent.length ? `${appendContent.join("\n")}\n` : "",
    "utf8",
  );
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
