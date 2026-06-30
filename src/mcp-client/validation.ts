import { Type } from "typebox";
import Value from "typebox/value";
import type { ResolvedMcpServer } from "./types.js";

const editableResolvedMcpServerSchema = Type.Union([
  Type.Object(
    {
      name: Type.String({ minLength: 1 }),
      scope: Type.Union([Type.Literal("project"), Type.Literal("global")]),
      transport: Type.Literal("stdio"),
      enabled: Type.Boolean(),
      description: Type.Optional(Type.String()),
      command: Type.String({ minLength: 1 }),
      args: Type.Optional(Type.Array(Type.String())),
      cwd: Type.Optional(Type.String({ minLength: 1 })),
      env: Type.Optional(Type.Record(Type.String(), Type.String())),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      name: Type.String({ minLength: 1 }),
      scope: Type.Union([Type.Literal("project"), Type.Literal("global")]),
      transport: Type.Literal("http"),
      enabled: Type.Boolean(),
      description: Type.Optional(Type.String()),
      url: Type.String({ minLength: 1 }),
      headers: Type.Optional(Type.Record(Type.String(), Type.String())),
    },
    { additionalProperties: false },
  ),
]);

export function parseEditConfigValues(
  values: Record<string, string>,
): ResolvedMcpServer {
  const enabledText = (values.enabled ?? "").trim().toLowerCase();
  if (enabledText !== "true" && enabledText !== "false") {
    throw new Error('enabled must be "true" or "false".');
  }
  const enabled = enabledText === "true";

  const name = (values.name ?? "").trim();
  const scope = (values.scope ?? "").trim();
  const transport = (values.transport ?? "").trim();
  const description = (values.description ?? "").trim();

  if (transport === "stdio") {
    const args = parseOptionalJsonValue(values.args, "args");
    const env = parseOptionalJsonValue(values.env, "env");
    const stdioServer = {
      name,
      scope,
      transport: "stdio",
      enabled,
      command: (values.command ?? "").trim(),
      ...(description ? { description } : {}),
      ...((values.cwd ?? "").trim() ? { cwd: (values.cwd ?? "").trim() } : {}),
      ...(args !== undefined ? { args } : {}),
      ...(env !== undefined ? { env } : {}),
    };

    validateWithTypebox(stdioServer);
    return stdioServer as ResolvedMcpServer;
  }

  if (transport === "http") {
    const headers = parseOptionalJsonValue(values.headers, "headers");
    const httpServer = {
      name,
      scope,
      transport: "http",
      enabled,
      url: (values.url ?? "").trim(),
      ...(description ? { description } : {}),
      ...(headers !== undefined ? { headers } : {}),
    };

    validateWithTypebox(httpServer);
    return httpServer as ResolvedMcpServer;
  }

  throw new Error('transport must be "stdio" or "http".');
}

function parseOptionalJsonValue(rawValue: string | undefined, fieldName: string): unknown {
  const trimmedValue = (rawValue ?? "").trim();
  if (!trimmedValue) {
    return undefined;
  }

  try {
    return JSON.parse(trimmedValue);
  } catch (error) {
    throw new Error(
      `Invalid JSON in ${fieldName}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function validateWithTypebox(server: unknown) {
  if (Value.Check(editableResolvedMcpServerSchema, server)) {
    return;
  }

  const validationErrors = Value.Errors(editableResolvedMcpServerSchema, server);
  const firstError = validationErrors[0];
  if (!firstError) {
    throw new Error("Invalid MCP server config.");
  }

  const fieldPath = firstError.instancePath.replace(/^\//, "").replaceAll("/", ".").trim();

  if (fieldPath.length > 0) {
    throw new Error(`Invalid ${fieldPath}: ${firstError.message}`);
  }

  throw new Error(`Invalid MCP server config: ${firstError.message}`);
}
