import { writeFile } from "node:fs/promises";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getPiPath } from "../utils.js";
import { DEFAULT_AGENT } from "./config.js";
import { loadAgentProfiles } from "./storage.js";

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

  let subagentPrompt = "";
  if (pi.getActiveTools().includes("subagent")) {
    subagentPrompt = `## Available agents for 'subagent' tool\n${agents
      .filter(({ name }) => name !== DEFAULT_AGENT)
      .map((profile) => `- ${profile.name}: ${profile.meta.description}`)
      .join("\n")}`;
  }
  await writeFile(getPiPath("system"), subagentPrompt, "utf8");
  return profile.agent;
}
