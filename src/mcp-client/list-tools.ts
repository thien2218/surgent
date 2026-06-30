import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { resolveServerConfig } from "./storage.js";
import { McpClientManager } from "./client.js";

export function createMcpListToolsTool(clientManager: McpClientManager) {
  return defineTool({
    name: "list_mcp_tools",
    label: "MCP List Tools",
    description: "List available tools from one or more configured MCP servers.",
    promptSnippet: "List available tools from one or more MCP servers with optional regex filter.",
    promptGuidelines: [
      "Use list_mcp_tools to discover available tool names before calling call_mcp_tool.",
      "Provide searchRegex to filter tools relevant to the task and avoid bloating context, especially for large MCP servers.",
    ],
    parameters: Type.Object({
      servers: Type.Array(Type.String({ description: "Configured server name" }), {
        description: "Server names to query",
      }),
      searchRegex: Type.Optional(
        Type.String({ description: "Regex pattern to filter tool names or descriptions" }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (signal?.aborted) {
        throw new Error("list_mcp_tools was cancelled.");
      }

      const filter = params.searchRegex ? new RegExp(params.searchRegex, "i") : null;
      const sections: string[] = [];

      for (const serverName of params.servers) {
        const serverConfig = await resolveServerConfig(ctx.cwd, serverName.trim());

        if (!serverConfig) {
          sections.push(`### ${serverName}\nError: Unknown MCP server. Configure it with /mcp.`);
          continue;
        }
        if (serverConfig.enabled === false) {
          sections.push(`### ${serverName}\nError: MCP server is disabled.`);
          continue;
        }

        if (signal?.aborted) {
          throw new Error("list_mcp_tools was cancelled.");
        }

        const toolsResult = await clientManager.listTools(serverConfig);
        const matched = filter
          ? toolsResult.tools.filter(
              (tool) => filter.test(tool.name) || filter.test(tool.description ?? ""),
            )
          : toolsResult.tools;

        if (matched.length === 0) {
          sections.push(
            `### ${serverName}\n${filter ? "No tools match the filter." : "No tools available."}`,
          );
          continue;
        }

        const lines = matched.map((tool) => {
          const description = tool.description ? `: ${tool.description}` : "";
          const inputSchema = JSON.stringify(tool.inputSchema, null, 2);
          return `- **${tool.name}**${description}\nInput schema:\n\`\`\`json\n${inputSchema}\n\`\`\``;
        });

        sections.push(`### ${serverName}\n${lines.join("\n\n")}`);
      }

      return {
        content: [{ type: "text", text: sections.join("\n\n") }],
        details: {
          servers: params.servers,
          filter: params.searchRegex ?? null,
        },
      };
    },
    renderCall(args, theme) {
      const serverList = Array.isArray(args.servers) ? args.servers.join(", ") : "";
      const filterPart = args.searchRegex ? ` [/${args.searchRegex}/]` : "";
      return new Text(
        `${theme.fg("toolTitle", "list_mcp_tools")} [${serverList}]${filterPart}`,
        0,
        0,
      );
    },
    renderResult(result, { isPartial }, theme) {
      if (isPartial) {
        return new Text(theme.fg("warning", "Listing MCP tools..."), 0, 0);
      }
      return new Text(theme.fg("dim", "MCP tools listed"), 0, 0);
    },
  });
}
