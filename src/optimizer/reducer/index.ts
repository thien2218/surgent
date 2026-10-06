import {
  createBashToolDefinition,
  createGrepToolDefinition,
  createLocalBashOperations,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { BashResultReducer } from "./bash.js";
import { formatGrepResult, filterGrepResult } from "./grep.js";
import Type from "typebox";
import { askForPermission } from "../../permission/index.js";
import { getState } from "../../state.js";

const localBash = createLocalBashOperations();

export default function (pi: ExtensionAPI) {
  const grepTool = createGrepToolDefinition(process.cwd());
  const bashTool = createBashToolDefinition(process.cwd(), {
    operations: {
      async exec(command, cwd, options) {
        const reducer = new BashResultReducer(options.onData);
        try {
          return await localBash.exec(command, cwd, {
            ...options,
            onData: (data) => reducer.append(data),
          });
        } finally {
          reducer.finish();
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
      const result = await grepTool.execute(toolCallId, params, signal, undefined, ctx);
      const state = getState(pi);
      const formatted = formatGrepResult(
        result.content.map((item) => (item.type === "text" ? item.text : "")).join("\n"),
      );
      const { text, check } = await filterGrepResult(formatted, params.path || ".", state, ctx);

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
    },
  });

  pi.registerTool({
    ...bashTool,
    description: `${bashTool.description} Output losslessly group similar consecutive lines with braces: 'status {200, 404, 500}' represents three lines 'status 200', 'status 404', 'status 500'. Expand one line per value, preserving order, duplicates, and line endings. Literal braces are escaped with backslash. Decode once.`,
    // Redaction replaces results with text; codemode must not expect a structured object.
    outputSchema: undefined,
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
}
