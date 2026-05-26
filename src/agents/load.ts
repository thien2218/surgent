import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadAgents, writeAgentPrompt } from "./storage.js";
import { getActiveAgent } from "./states.js";
import { getPiGlobalPath } from "../utils.js";

function resolveAllowedTools(
  pi: ExtensionAPI,
  tools?: string[],
  mcpServers?: string[],
): string[] | null {
  if (!tools && !mcpServers) return null;

  const allowed: string[] = [];
  for (const tool of pi.getAllTools()) {
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

export function registerAgentHooks(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    const agents = await loadAgents(ctx.cwd);
    const name = getActiveAgent();
    const agent =
      agents.find((candidate) => candidate.meta.name === name) ??
      agents.find((candidate) => candidate.meta.name === "default") ??
      null;

    if (agent) {
      await writeAgentPrompt(agent.body);
    }

    if (agent?.meta.tools || agent?.meta.mcp_servers) {
      const allowed = resolveAllowedTools(pi, agent.meta.tools, agent.meta.mcp_servers);
      if (allowed) pi.setActiveTools(allowed);
    }

    if (agent?.meta.model) {
      const modelId = agent.meta.model;
      const model = ctx.modelRegistry
        .getAll()
        .find((model) => model.id === modelId || model.id.endsWith(`/${modelId}`));

      if (model) {
        const ok = await pi.setModel(model);
        if (!ok) ctx.ui.notify(`Agent model "${modelId}" unavailable`, "warning");
      } else {
        ctx.ui.notify(`Unknown model "${modelId}" in agent config`, "warning");
      }
    }
  });

  pi.on("resources_discover", async () => ({
    promptPaths: [getPiGlobalPath("agent-prompt")],
  }));
}
