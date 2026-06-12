import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import pm from "picomatch";
import { agentsCommandHandler } from "./command.js";
import { loadMainAgent } from "./load.js";
import { loadAgents, readSessionAgent } from "./storage.js";
import { loadResolvedConfigSet } from "../mcp-client/storage.js";
import { IS_SUBSESSION, ALLOWED_FILES } from "../subsession/index.js";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("agents", {
    description: "List, create, edit, and switch agents",
    handler: (_args, ctx) => agentsCommandHandler(ctx),
  });

  pi.on("tool_call", (event) => {
    if (!IS_SUBSESSION || !ALLOWED_FILES) return;

    let allowedFiles: string[];
    try {
      allowedFiles = JSON.parse(ALLOWED_FILES) as string[];
    } catch {
      return;
    }

    const matchers = allowedFiles.map((pattern) => pm(pattern, { dot: true }));
    const pathTools = new Set(["read", "write", "edit", "grep", "find", "ls"]);
    const eventWithPath = event as { toolName: string; input: { path?: string } };
    if (!pathTools.has(eventWithPath.toolName)) return;

    const target = eventWithPath.input.path;
    if (!target) {
      // grep/find/ls without explicit path would search cwd implicitly — block it
      return { block: true, reason: "Explicit path required in subsession" };
    }

    const allowed = matchers.some((match) => match(target));
    if (!allowed) return { block: true, reason: `Path outside allowed scope: ${target}` };
  });

  pi.on("session_start", async (_event, ctx) => {
    const sessionAgent = await readSessionAgent(ctx.cwd, ctx.sessionManager.getSessionId());
    ctx.ui.setStatus("agent", ctx.ui.theme.fg("dim", `agent: ${sessionAgent}`));

    const [agents, allMcpConfigs] = await Promise.all([
      loadAgents(ctx.cwd),
      loadResolvedConfigSet(ctx.cwd),
    ]);

    const { tools, model } = await loadMainAgent(ctx, agents, sessionAgent, {
      tools: pi.getAllTools().map((tool) => tool.name),
      mcp: allMcpConfigs.filter((cfg) => cfg.enabled === true),
    });

    if (tools) {
      pi.setActiveTools(tools);
    }
    if (model) {
      const ok = pi.setModel(model);
      if (!ok) ctx.ui.notify("Agent model unavailable", "warning");
    }
  });
}
