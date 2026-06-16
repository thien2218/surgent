import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { resolveServerConfig } from "./storage.js";
import { McpClientManager } from "./client.js";
import type { McpToolCallDetails } from "./types.js";

export function createMcpCallTool(clientManager: McpClientManager) {
  return defineTool({
    name: "call_mcp_tool",
    label: "MCP Call Tool",
    description: "Call known tool on configured MCP server.",
    promptSnippet: "Call known tool on configured MCP server.",
    promptGuidelines: [
      "Use call_mcp_tool only with known server and tool names.",
      "Use call_mcp_tool instead of recreating capability already exposed by MCP.",
      "Use call_mcp_tool arguments as schema-matching JSON.",
    ],
    parameters: Type.Object({
      server: Type.String({ description: "Configured server name" }),
      tool: Type.String({ description: "Remote tool name" }),
      arguments: Type.Optional(
        Type.Object({}, { additionalProperties: true, description: "JSON arguments" }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (signal?.aborted) {
        throw new Error("call_mcp_tool was cancelled.");
      }

      const serverName = params.server.trim();
      const toolName = params.tool.trim();
      const serverConfig = await resolveServerConfig(ctx.cwd, serverName);

      if (!serverConfig) {
        throw new Error(`Unknown MCP server: ${serverName}. Configure it with /mcp.`);
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
        throw new Error("call_mcp_tool was cancelled.");
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
          remoteTool: toolName,
          ...(result.isError ? { isError: true } : {}),
        } satisfies McpToolCallDetails,
      };
    },
    renderCall(args, theme) {
      return new Text(
        `${theme.fg("toolTitle", "call_mcp_tool")} [${args.server}:${args.tool}]`,
        0,
        0,
      );
    },
    renderResult(result, { isPartial }, theme) {
      if (isPartial) {
        return new Text(theme.fg("warning", "Calling MCP tool..."), 0, 0);
      }

      const details = result.details as McpToolCallDetails | undefined;
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
