import { statSync } from "node:fs";
import {
  createBashToolDefinition,
  createGrepToolDefinition,
  createLocalBashOperations,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { BashResultCompactor } from "./bash.js";
import {
  rewriteTailWithSummaries,
  extractGrepSummary,
  formatGrepResult,
  filterGrepResult,
} from "./grep.js";
import Type from "typebox";
import { askForPermission } from "../../permission/index.js";
import { getState } from "../../state.js";

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
    description: `${grepTool.description} Results remain available throughout the current task and are compacted into summaries only after you finish responding to the user.`,
    parameters: Type.Object({
      ...grepTool.parameters.properties,
      context: Type.Optional(
        Type.Number({
          description: "Number of lines to show before and after each match (default: 0)",
          maximum: 3,
        }),
      ),
    }),
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      try {
        const result = await grepTool.execute(toolCallId, params, signal, undefined, ctx);
        if (result.content.some((item) => item.type !== "text")) {
          throw new Error("Unexpected grep result content");
        }

        const state = getState(pi);
        const formatted = formatGrepResult(
          result.content.map((item) => (item.type === "text" ? item.text : "")).join("\n"),
        );
        const { text, check } = await filterGrepResult(formatted, params.path || ".", pi, ctx);

        if (state.getMode() !== "yolo" && check) {
          const decision = await askForPermission(pi, ctx, check);
          if (decision?.block) throw new Error(decision.reason);
        }
        // Truncation contains raw text and pre-filter counts; only search-limit flags remain valid.
        return {
          content: [{ type: "text", text }],
          details: result.details && {
            matchLimitReached: result.details.matchLimitReached,
            linesTruncated: result.details.linesTruncated,
          },
        };
      } catch {
        throw new Error("Grep result unavailable: search failed or permission was denied");
      }
    },
  });

  pi.registerTool({
    ...bashTool,
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
}
