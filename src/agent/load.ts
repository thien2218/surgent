import { writeAgentPrompt } from "./storage.js";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { Agent } from "./types.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ResolvedMcpServerConfig } from "../mcp-client/types.js";

type AvailableSettings = {
  tools: string[];
  mcp: ResolvedMcpServerConfig[];
};

export async function loadMainAgent(
  ctx: ExtensionContext,
  agents: Agent[],
  sessionAgent: string,
  available: AvailableSettings,
) {
  const config: { model?: Model<Api>; tools?: string[] } = {};
  const agent =
    agents.find((candidate) => candidate.meta.name === sessionAgent) ??
    agents.find((candidate) => candidate.meta.name === "default") ??
    null;

  if (!agent) return config;
  const { meta } = agent;

  config.tools =
    meta.tools === "all"
      ? available.tools
      : available.tools.filter((name) => (meta.tools ?? []).includes(name));

  if (meta.model) {
    const existing = ctx.modelRegistry
      .getAll()
      .find((item) => item.id === meta.model || item.id.endsWith(`/${meta.model}`));

    if (existing) {
      config.model = existing;
    } else {
      ctx.ui.notify(`Unknown model "${meta.model}" in agent config`, "warning");
    }
  }

  const allowedMcp =
    meta.mcp_servers === "all"
      ? available.mcp
      : available.mcp.filter((cfg) => (meta.mcp_servers ?? []).includes(cfg.name));
  const lines = allowedMcp.map((cfg) =>
    cfg.description ? `- ${cfg.name} - ${cfg.description}` : `- ${cfg.name}`,
  );
  const appendContent = lines.length > 0 ? `## Enabled MCP Servers\n${lines.join("\n")}\n` : "";

  await writeAgentPrompt(appendContent, "appendSystem", ctx.cwd);

  return config;
}
