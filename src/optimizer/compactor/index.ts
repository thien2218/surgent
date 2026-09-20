import { statSync } from "node:fs";
import {
  createBashToolDefinition,
  createGrepToolDefinition,
  createLocalBashOperations,
  isGrepToolResult,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { BashResultCompactor } from "./bash.js";
import { rewriteTailWithSummaries, extractGrepSummary, formatGrepResult } from "./grep.js";
import Type from "typebox";

const localBash = createLocalBashOperations();

export default function (pi: ExtensionAPI) {
  let writeStartOffset = 0;
  const store = new Map<string, string>();
  const grepTool = createGrepToolDefinition(process.cwd());
  const bashTool = createBashToolDefinition(process.cwd(), {
    operations: {
      async exec(command, cwd, options) {
        const compactor = new BashResultCompactor(options.onData);
        try {
          return await localBash.exec(command, cwd, {
            ...options,
            onData: (data) => compactor.append(data),
          });
        } finally {
          compactor.finish();
        }
      },
    },
  });

  pi.registerTool({
    ...grepTool,
    parameters: Type.Object({
      ...grepTool.parameters.properties,
      context: Type.Optional(
        Type.Number({
          description: "Number of lines to show before and after each match (default: 0)",
          maximum: 3,
        }),
      ),
    }),
  });

  pi.registerTool({
    ...bashTool,
    description:
      "Execute a bash command in the current working directory. Strips ANSI escapes, collapses carriage-return updates, removes consecutive duplicate lines, then optionally filters lines with a JavaScript regex before truncating to the last 2000 lines or 50KB. Saved full output is compacted.",
    parameters: Type.Object({
      ...bashTool.parameters.properties,
      purpose: Type.String({
        description: "Briefly explain what this command will do and why before running it",
        minLength: 1,
        maxLength: 256,
        pattern: "\\S",
      }),
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

  pi.on("agent_end", async (event) => {
    for (const message of event.messages) {
      if (message.role !== "toolResult" || message.toolName !== "grep") continue;
      const text = message.content.find((content) => content.type === "text")?.text;
      if (text === undefined) continue;

      const summary = extractGrepSummary(text);
      if (!summary) continue;
      store.set(message.toolCallId, summary);
    }
  });

  pi.on("session_shutdown", (event, ctx) => {
    if (store.size === 0) return;

    const sessionFile = ctx.sessionManager.getSessionFile();
    if (sessionFile) {
      rewriteTailWithSummaries(sessionFile, writeStartOffset, store);
    }
    if (event.targetSessionFile && event.targetSessionFile !== sessionFile) {
      rewriteTailWithSummaries(event.targetSessionFile, writeStartOffset, store);
    }
  });

  pi.on("context", async (event) => {
    if (store.size === 0) return;

    let changed = false;
    for (const message of event.messages) {
      if (message.role !== "toolResult" || message.toolName !== "grep") continue;

      const summary = store.get(message.toolCallId);
      if (summary === undefined) continue;

      message.content = [{ type: "text", text: summary }];
      changed = true;
    }

    if (!changed) return;
    return { messages: event.messages };
  });

  pi.on("tool_result", async (event) => {
    if (!isGrepToolResult(event) || event.isError) return;

    let changed = false;
    const content = event.content.map((item) => {
      if (item.type !== "text") return item;

      const text = formatGrepResult(item.text);
      if (text === item.text) return item;

      changed = true;
      return { ...item, text };
    });

    if (changed) return { content };
  });
}
