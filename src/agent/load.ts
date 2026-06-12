import { writeAgentPrompt } from "./storage.js";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { Agent } from "./types.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ResolvedMcpServerConfig } from "../mcp-client/types.js";

type AvailableSettings = {
  tools: string[];
  mcp: ResolvedMcpServerConfig[];
};

async function writeSystemPrompt(
  cwd: string,
  prompt: string,
  allowed: Omit<AvailableSettings, "tools">,
) {
  const lines = allowed.mcp.map((cfg) =>
    cfg.description ? `- ${cfg.name} - ${cfg.description}` : `- ${cfg.name}`,
  );
  const appendContent = lines.length > 0 ? `## Enabled MCP Servers\n${lines.join("\n")}\n` : "";
  await writeAgentPrompt(appendContent, "appendSystem", cwd);
  await writeAgentPrompt(prompt, "system");
}

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

  const allowedTools = !meta.tools
    ? available.tools
    : available.tools.filter((tool) => meta.tools!.includes(tool));

  if (allowedTools) {
    config.tools = allowedTools;
  }

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

  const allowedMcp = !meta.mcp_servers
    ? available.mcp
    : available.mcp.filter((cfg) => meta.mcp_servers!.includes(cfg.name));

  await writeSystemPrompt(ctx.cwd, agent.body, { mcp: allowedMcp });

  return config;
}
