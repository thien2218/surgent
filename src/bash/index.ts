import { createBashToolDefinition, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const bashSchema = Type.Object({
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
});

export default function (pi: ExtensionAPI) {
  const bashTool = createBashToolDefinition(process.cwd());

  pi.registerTool({
    ...bashTool,
    parameters: bashSchema,
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
}
