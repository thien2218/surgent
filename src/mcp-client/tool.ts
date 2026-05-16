import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { resolveServerConfig } from "./config.js";
import { McpClientManager } from "./client.js";
import type { McpCallToolDetails } from "./types.js";

export default function registerMcpCallTool(pi: ExtensionAPI, clientManager: McpClientManager) {
  const mcpCallTool = defineTool({
    name: "mcp_call_tool",
    label: "MCP Call Tool",
    description: "Call a tool exposed by a configured MCP server over stdio or HTTP.",
    promptSnippet:
      "Call a configured MCP server tool when the server name and remote tool name are known.",
    promptGuidelines: [
      "Use mcp_call_tool only after choosing a configured MCP server and a known remote tool name.",
      "Prefer mcp_call_tool when the capability already exists behind an MCP server instead of reproducing the logic locally.",
      "Pass a JSON object in arguments that matches the remote MCP tool schema.",
    ],
    parameters: Type.Object({
      server: Type.String({ description: "Configured MCP server name from /mcp-config" }),
      tool: Type.String({ description: "Remote MCP tool name to invoke" }),
      arguments: Type.Optional(
        Type.Object(
          {},
          {
            additionalProperties: true,
            description: "JSON object passed to the remote MCP tool as arguments",
          },
        ),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (signal?.aborted) {
        throw new Error("mcp_call_tool was cancelled.");
      }

      const serverName = params.server.trim();
      const toolName = params.tool.trim();
      const serverConfig = await resolveServerConfig(ctx.cwd, serverName);

      if (!serverConfig) {
        throw new Error(`Unknown MCP server: ${serverName}. Configure it with /mcp-config.`);
      }

      if (serverConfig.enabled === false) {
        throw new Error(`MCP server ${serverName} is disabled.`);
      }

      const toolsResult = await clientManager.listTools(serverConfig);
      const remoteTool = toolsResult.tools.find((item) => item.name === toolName);

      if (!remoteTool) {
        const availableTools = toolsResult.tools
          .map((item) => item.name)
          .sort()
          .join(", ");
        throw new Error(
          `MCP server ${serverName} does not expose ${toolName}.${availableTools ? ` Available tools: ${availableTools}.` : ""}`,
        );
      }

      if (signal?.aborted) {
        throw new Error("mcp_call_tool was cancelled.");
      }

      const result = await clientManager.callTool(serverConfig, {
        name: toolName,
        arguments: (params.arguments ?? {}) as Record<string, unknown>,
      });

      const text = formatCallToolResult(result);

      return {
        content: [{ type: "text", text }],
        details: {
          server: serverConfig.name,
          transport: serverConfig.transport,
          scope: serverConfig.scope,
          remoteTool: toolName,
          contentTypes: collectContentTypes(result),
          ...(hasStructuredContent(result) ? { structuredContent: result.structuredContent } : {}),
          ...(result.isError ? { isError: true } : {}),
        } satisfies McpCallToolDetails,
      };
    },
    renderCall(args, theme) {
      return new Text(
        `${theme.fg("toolTitle", "mcp_call_tool")} [${args.server}:${args.tool}]`,
        0,
        0,
      );
    },
    renderResult(result, { isPartial }, theme) {
      if (isPartial) {
        return new Text(theme.fg("warning", "Calling MCP tool..."), 0, 0);
      }

      const details = result.details as McpCallToolDetails | undefined;
      if (!details) {
        return new Text(theme.fg("dim", "MCP tool completed"), 0, 0);
      }

      const tone = details.isError ? "error" : "success";
      return new Text(
        theme.fg(
          tone,
          `${details.server}:${details.remoteTool} via ${details.transport}${details.isError ? " (remote error)" : ""}`,
        ),
        0,
        0,
      );
    },
  });

  pi.registerTool(mcpCallTool);
}

function formatCallToolResult(result: {
  content?: Array<Record<string, unknown>>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  toolResult?: unknown;
}): string {
  if ("toolResult" in result) {
    return JSON.stringify(result.toolResult, null, 2);
  }

  const chunks: string[] = [];
  for (const item of result.content ?? []) {
    if (item.type === "text" && typeof item.text === "string") {
      chunks.push(item.text);
      continue;
    }

    if (item.type === "image" && typeof item.mimeType === "string") {
      chunks.push(`[image content: ${item.mimeType}]`);
      continue;
    }

    if (item.type === "audio" && typeof item.mimeType === "string") {
      chunks.push(`[audio content: ${item.mimeType}]`);
      continue;
    }

    if (item.type === "resource" && item.resource && typeof item.resource === "object") {
      const resource = item.resource as Record<string, unknown>;
      if (typeof resource.uri === "string" && typeof resource.text === "string") {
        chunks.push(`Resource ${resource.uri}\n${resource.text}`);
        continue;
      }
      if (typeof resource.uri === "string") {
        chunks.push(`[resource content: ${resource.uri}]`);
        continue;
      }
    }

    if (item.type === "resource_link" && typeof item.uri === "string") {
      chunks.push(`[resource link: ${item.uri}]`);
      continue;
    }

    chunks.push(JSON.stringify(item, null, 2));
  }

  if (result.structuredContent && Object.keys(result.structuredContent).length > 0) {
    chunks.push(JSON.stringify(result.structuredContent, null, 2));
  }

  const body = chunks.filter(Boolean).join("\n\n").trim();
  if (!body) {
    return result.isError
      ? "MCP tool returned an error with no content."
      : "MCP tool returned no content.";
  }

  return result.isError ? `Remote MCP tool reported an error.\n\n${body}` : body;
}

function collectContentTypes(result: {
  content?: Array<Record<string, unknown>>;
  toolResult?: unknown;
}): string[] {
  if ("toolResult" in result) {
    return ["toolResult"];
  }
  const values = new Set<string>();
  for (const item of result.content ?? []) {
    if (typeof item.type === "string") {
      values.add(item.type);
    }
  }
  return Array.from(values);
}

function hasStructuredContent(
  result: unknown,
): result is { structuredContent: Record<string, unknown> } {
  if (!result || typeof result !== "object" || !("structuredContent" in result)) {
    return false;
  }

  const value = (result as { structuredContent?: Record<string, unknown> }).structuredContent;
  return Boolean(value) && Object.keys(value ?? {}).length > 0;
}
