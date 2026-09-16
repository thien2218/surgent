import { statSync } from "node:fs";
import {
  createBashToolDefinition,
  isGrepToolResult,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { createCompactingBashOperations } from "./bash.js";
import { rewriteTailWithSummaries, extractGrepSummary, formatGrepResult } from "./grep.js";
import Type from "typebox";

export default function (pi: ExtensionAPI) {
  const bashTool = createBashToolDefinition(process.cwd());
  const store = new Map<string, { summary: string; state: "pending" | "active" }>();
  const pendingWrites = new Map<string, string>();
  let writeStartOffset = 0;

  pi.registerTool({
    ...bashTool,
    description:
      "Execute a bash command in the current working directory. Strips ANSI escapes, collapses carriage-return updates, removes consecutive duplicate lines, then optionally filters lines with a JavaScript regex before truncating to the last 2000 lines or 50KB. Saved full output is compacted.",
    parameters: Type.Object({
      command: Type.String({ description: "Bash command to execute" }),
      purpose: Type.String({
        description: "Briefly explain what this command will do and why before running it",
        minLength: 1,
        maxLength: 256,
        pattern: "\\S",
      }),
      filter: Type.Optional(
        Type.String({
          description:
            "Focused JavaScript regex that retains matching output lines. Use this if command is expected to have long output to save context",
          minLength: 1,
        }),
      ),
      timeout: Type.Optional(
        Type.Number({ description: "Timeout in seconds (optional, no default timeout)" }),
      ),
    }),
    prepareArguments: undefined,
    execute(toolCallId, params, signal, onUpdate, ctx) {
      const compactingBashTool = createBashToolDefinition(process.cwd(), {
        operations: createCompactingBashOperations(params.filter),
      });
      return compactingBashTool.execute(
        toolCallId,
        { command: params.command, timeout: params.timeout },
        signal,
        onUpdate,
        ctx,
      );
    },
  });

  pi.on("agent_start", async (_event, ctx) => {
    if (store.size > 0) return;

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

  pi.on("turn_end", async (event) => {
    for (const [toolCallId, compaction] of store) {
      if (compaction.state !== "pending") continue;
      store.set(toolCallId, { ...compaction, state: "active" });
      pendingWrites.set(toolCallId, compaction.summary);
    }

    for (const message of event.toolResults) {
      if (message.toolName !== "grep") continue;
      const text = message.content.find((content) => content.type === "text")?.text;
      if (text === undefined) continue;

      const summary = extractGrepSummary(text);
      if (!summary) continue;
      store.set(message.toolCallId, { summary, state: "pending" });
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

      const compaction = store.get(message.toolCallId);
      if (compaction?.state !== "active") continue;

      message.content = [{ type: "text", text: compaction.summary }];
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
