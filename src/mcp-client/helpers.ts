import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { normalizeServerConfig, readConfigFile, updateServerConfig } from "./storage.js";
import type { ResolvedMcpServer } from "./types.js";
import type { Field } from "../ui/components/form-field.js";

export async function saveEditedServer(
  ctx: ExtensionCommandContext,
  previous: ResolvedMcpServer,
  updated: ResolvedMcpServer,
) {
  if (
    (updated.scope !== previous.scope || updated.name !== previous.name) &&
    Object.hasOwn(await readConfigFile(updated.scope, ctx.cwd), updated.name)
  ) {
    throw new Error(`MCP server ${updated.name} already exists in ${updated.scope} scope.`);
  }

  const updatedConfig = normalizeServerConfig(updated.name, updated);

  await updateServerConfig(updated.scope, ctx.cwd, updated.name, {
    config: updatedConfig,
    kind: "upsert",
  });

  if (updated.scope !== previous.scope || updated.name !== previous.name) {
    await updateServerConfig(previous.scope, ctx.cwd, previous.name, { kind: "delete" });
  }

  ctx.ui.notify(`Updated MCP server ${previous.name}.`, "info");
}

export function getEditFields(server: ResolvedMcpServer): Field<string | number | boolean>[] {
  const base: Field<string | number | boolean>[] = [
    {
      key: "name",
      label: "name",
      labelWidth: 18,
      mode: {
        type: "input",
        placeholder: "MCP server name",
        text: server.name,
      },
    },
    {
      key: "scope",
      label: "scope",
      labelWidth: 18,
      mode: {
        type: "toggle",
        values: ["project", "global"],
        initialIndex: server.scope === "project" ? 0 : 1,
      },
    },
    {
      key: "transport",
      label: "transport",
      labelWidth: 18,
      mode: {
        type: "toggle",
        values: ["stdio", "http"],
        initialIndex: server.transport === "stdio" ? 0 : 1,
      },
    },
    {
      key: "enabled",
      label: "enabled",
      labelWidth: 18,
      mode: {
        type: "toggle",
        values: ["true", "false"],
        initialIndex: server.enabled ? 0 : 1,
      },
    },
    {
      key: "description",
      label: "description",
      labelWidth: 18,
      mode: {
        type: "input",
        placeholder: "Optional description",
        text: server.description ?? "",
      },
    },
  ];

  if (server.transport === "stdio") {
    return base.concat([
      {
        key: "command",
        label: "command",
        labelWidth: 18,
        mode: {
          type: "input",
          placeholder: "Required when transport=stdio",
          text: server.command,
        },
      },
      {
        key: "args",
        label: "args",
        labelWidth: 18,
        mode: {
          type: "input",
          placeholder: "Optional JSON string array",
          text: server.args ? JSON.stringify(server.args) : "",
        },
      },
      {
        key: "cwd",
        label: "cwd",
        labelWidth: 18,
        mode: {
          type: "input",
          placeholder: "Optional working directory",
          text: server.cwd ?? "",
        },
      },
      {
        key: "env",
        label: "env",
        labelWidth: 18,
        mode: {
          type: "input",
          placeholder: "Optional JSON object of env vars",
          text: server.env ? JSON.stringify(server.env) : "",
        },
      },
    ]);
  }

  return base.concat([
    {
      key: "url",
      label: "url",
      labelWidth: 18,
      mode: {
        type: "input",
        placeholder: "Required when transport=http",
        text: server.url,
      },
    },
    {
      key: "headers",
      label: "headers",
      labelWidth: 18,
      mode: {
        type: "input",
        placeholder: "Optional JSON object of headers",
        text: server.headers ? JSON.stringify(server.headers) : "",
      },
    },
  ]);
}
