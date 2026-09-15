import { statSync } from "node:fs";
import {
  createBashToolDefinition,
  isGrepToolResult,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { rewriteTailWithSummaries, extractGrepSummary, formatGrepResult } from "./helpers.js";
import Type from "typebox";

export default function (pi: ExtensionAPI) {
  const bashTool = createBashToolDefinition(process.cwd());
  const store = new Map<string, string>();
  const pendingWrites = new Map<string, string>();
  let writeStartOffset = 0;

  pi.registerTool({
    ...bashTool,
    parameters: Type.Object({
      command: Type.String({ description: "Bash command to execute" }),
      purpose: Type.String({
        description: "Briefly explain what this command will do and why before running it",
        minLength: 1,
        maxLength: 256,
        pattern: "\\S",
      }),
      timeout: Type.Optional(
        Type.Number({ description: "Timeout in seconds (optional, no default timeout)" }),
      ),
    }),
    prepareArguments: undefined,
    execute(toolCallId, params, signal, onUpdate, ctx) {
      return bashTool.execute(
        toolCallId,
        { command: params.command, timeout: params.timeout },
        signal,
        onUpdate,
        ctx,
      );
    },
  });

  pi.on("agent_start", async (_event, ctx) => {
    if (pendingWrites.size > 0) return;

    const sessionFile = ctx.sessionManager.getSessionFile();
    if (!sessionFile) {
      writeStartOffset = 0;
      return;
    }

    try {
      writeStartOffset = statSync(sessionFile).size;
    } catch {
      writeStartOffset = 0;
    }
  });

  pi.on("agent_end", async (event) => {
    for (const message of event.messages) {
      if (message.role !== "toolResult" || message.toolName !== "grep") continue;
      const text = message.content.find((content) => content.type === "text")?.text;
      if (text === undefined) continue;

      const summary = extractGrepSummary(text);
      if (!summary) continue;
      store.set(message.toolCallId, summary);
      pendingWrites.set(message.toolCallId, summary);
    }
  });

  pi.on("session_shutdown", (event, ctx) => {
    if (pendingWrites.size === 0) return;

    const sessionFile = ctx.sessionManager.getSessionFile();
    if (sessionFile) {
      rewriteTailWithSummaries(sessionFile, writeStartOffset, pendingWrites);
    }
    if (event.targetSessionFile && event.targetSessionFile !== sessionFile) {
      rewriteTailWithSummaries(event.targetSessionFile, writeStartOffset, pendingWrites);
    }
  });

  pi.on("context", async (event) => {
    if (store.size === 0) return;

    let changed = false;
    for (const message of event.messages) {
      if (message.role !== "toolResult" || message.toolName !== "grep") continue;

      const summaryText = store.get(message.toolCallId);
      if (!summaryText) continue;

      message.content = [{ type: "text", text: summaryText }];
      changed = true;
    }

    if (!changed) return;
    return { messages: event.messages };
  });

  pi.on("tool_result", async (event) => {
    if (!isGrepToolResult(event) || event.isError) return;

    const content = event.content.map((item) => {
      if (item.type !== "text") return item;
      const text = formatGrepResult(item.text);
      return text === item.text ? item : { ...item, text };
    });
    const changed = content.some((item, index) => item !== event.content[index]);

    if (changed) return { content };
  });
}
