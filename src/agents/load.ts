import type { ExtensionContext, ToolInfo } from "@earendil-works/pi-coding-agent";
import { loadAgents, writeAgentPrompt } from "./storage.js";
import { getActiveAgent } from "./states.js";
import type { Api, Model } from "@earendil-works/pi-ai";

function resolveAllowedTools(
  availTools: ToolInfo[],
  tools?: string[],
  mcpServers?: string[],
): string[] | null {
  if (!tools && !mcpServers) return null;

  const allowed: string[] = [];
  for (const tool of availTools) {
    const src = tool.sourceInfo.source;
    const isMcp = src !== "builtin" && src !== "sdk" && src !== "extension";

    if (isMcp) {
      if (!mcpServers || mcpServers.includes(src)) allowed.push(tool.name);
    } else {
      if (!tools || tools.includes(tool.name)) allowed.push(tool.name);
    }
  }
  return allowed;
}

export async function loadAgent(ctx: ExtensionContext, availTools: ToolInfo[]) {
  const agents = await loadAgents(ctx.cwd);
  const name = getActiveAgent();
  const result: { model?: Model<Api>; tools: string[] | null } = { tools: null };
  const agent =
    agents.find((candidate) => candidate.meta.name === name) ??
    agents.find((candidate) => candidate.meta.name === "default") ??
    null;

  if (agent) {
    await writeAgentPrompt(agent.body);
  }

  if (agent?.meta.tools || agent?.meta.mcp_servers) {
    const allowed = resolveAllowedTools(availTools, agent.meta.tools, agent.meta.mcp_servers);
    if (allowed) {
      result.tools = allowed;
    }
  }

  if (agent?.meta.model) {
    const modelId = agent.meta.model;
    const model = ctx.modelRegistry
      .getAll()
      .find((model) => model.id === modelId || model.id.endsWith(`/${modelId}`));

    if (model) {
      result.model = model;
    } else {
      ctx.ui.notify(`Unknown model "${modelId}" in agent config`, "warning");
    }
  }

  return result;
}
