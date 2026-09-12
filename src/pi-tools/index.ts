import {
  createBashToolDefinition,
  isGrepToolResult,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

function formatGrepResult(content: string): string {
  const formattedLines: string[] = [];
  let currentFilePath: string | undefined;
  let changed = false;

  for (const line of content.split("\n")) {
    const matchLine = line.match(/^(.+?):(\d+): (.*)$/);
    const contextLine = matchLine ? null : line.match(/^(.+?)-(\d+)- (.*)$/);
    const filePath = matchLine?.[1] ?? contextLine?.[1];
    const lineNumber = matchLine?.[2] ?? contextLine?.[2];
    const lineText = matchLine?.[3] ?? contextLine?.[3];

    if (!filePath || !lineNumber || lineText === undefined) {
      formattedLines.push(line);
      continue;
    }

    if (filePath !== currentFilePath) {
      formattedLines.push(filePath);
      currentFilePath = filePath;
    }
    formattedLines.push(`${lineNumber}${matchLine ? ":" : "-"} ${lineText}`);
    changed = true;
  }

  return changed ? formattedLines.join("\n") : content;
}

export default function (pi: ExtensionAPI) {
  const bashTool = createBashToolDefinition(process.cwd());
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
