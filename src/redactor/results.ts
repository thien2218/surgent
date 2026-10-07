import type { JsonValue } from "@earendil-works/pi-ai";
import { createBashToolDefinition, type ToolResultEvent, type ToolResultEventResult } from "@earendil-works/pi-coding-agent";
import { Check } from "typebox/value";
import { containSecrets, replaceSecrets } from "./secrets.js";

// Native Bash and PowerShell use the same unconstrained shell result schema.
const shellSchema = createBashToolDefinition(process.cwd()).outputSchema!;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error("Invalid result object");
  }
  return value as Record<string, unknown>;
}

function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid result text");
  return value;
}

function binary(value: unknown): string {
  const data = string(value);
  if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
    throw new Error("Invalid binary result");
  }
  return data;
}

function json(value: unknown, parents = new Set<object>(), key?: string): JsonValue {
  if (typeof value === "string") {
    const redacted = replaceSecrets(value);
    // Detectors such as client_secret need the JSON property's name as context.
    if (key !== undefined && containSecrets(`${JSON.stringify(key)}: ${JSON.stringify(redacted)}`)) {
      return "(redacted texts)";
    }
    return redacted;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || !value || parents.has(value)) throw new Error("Invalid JSON result");
  parents.add(value);
  try {
    const result = Array.isArray(value)
      ? Array.from(value, (item) => json(item, parents))
      : Object.fromEntries(Object.entries(object(value)).map(([key, item]) => [key, json(item, parents, key)]));
    // Keys must stay unchanged. Reject residual secrets in keys or spanning
    // ancestor context rather than expose them through programmatic output.
    if (parents.size === 1 && containSecrets(JSON.stringify(result))) throw new Error("Unsafe JSON context");
    return result;
  } finally {
    parents.delete(value);
  }
}

function resource(value: unknown): JsonValue {
  const data = object(value);
  string(data.uri);
  if (data.mimeType !== undefined) string(data.mimeType);
  if (data.text !== undefined) {
    string(data.text);
    if (data.blob !== undefined) throw new Error("Ambiguous resource result");
    return json(data);
  }
  const { blob, ...metadata } = data;
  return { ...object(json(metadata)), blob: binary(blob) } as JsonValue;
}

function block(value: unknown): JsonValue {
  const data = object(value);
  switch (data.type) {
    case "text":
      string(data.text);
      return json(data);
    case "image":
    case "audio": {
      string(data.mimeType);
      const { data: bytes, ...metadata } = data;
      return { ...object(json(metadata)), data: binary(bytes) } as JsonValue;
    }
    case "resource": {
      const { resource: contents, ...metadata } = data;
      return { ...object(json(metadata)), resource: resource(contents) } as JsonValue;
    }
    case "resource_link":
      string(data.uri);
      string(data.name);
      return json(data);
    default:
      throw new Error("Unsupported result block");
  }
}

function structured(event: ToolResultEvent): JsonValue {
  const value = event.structuredContent;
  if (event.toolName.startsWith("mcp__")) {
    const envelope = object(value);
    if (!Array.isArray(envelope.content) ||
      (envelope.isError !== undefined && typeof envelope.isError !== "boolean")) {
      throw new Error("Invalid MCP result");
    }
    const { content, ...metadata } = envelope;
    const sanitized = json(metadata);
    // Pi's result hooks do not expose MCP output schemas. Changed embedded data
    // could violate a const/enum/pattern: reject rather than claim valid success.
    if (JSON.stringify(envelope.structuredContent) !==
      JSON.stringify(object(sanitized).structuredContent)) {
      throw new Error("Cannot validate redacted MCP data");
    }
    return { ...object(sanitized), content: content.map(block) } as JsonValue;
  }
  if (event.toolName === "codemode") return replaceSecrets(string(value));
  if (event.toolName === "read" && typeof value !== "string") {
    const image = object(value);
    if (image.type !== "image") throw new Error("Invalid read result");
    string(image.note);
    return block(image);
  }
  if (event.toolName === "read_mcp_resource") {
    const { contents, ...metadata } = object(value);
    string(metadata.server);
    string(metadata.uri);
    if (!Array.isArray(contents)) throw new Error("Invalid resource contents");
    return { ...object(json(metadata)), contents: contents.map(resource) } as JsonValue;
  }
  const sanitized = json(value);
  if ((event.toolName === "bash" || event.toolName === "powershell") && !Check(shellSchema, sanitized)) {
    throw new Error("Invalid shell result");
  }
  return sanitized;
}

export function sanitizeResult(event: ToolResultEvent): ToolResultEventResult {
  try {
    const content = event.content.map((item) => {
      // Keep Pi content types and opaque image bytes; sanitize text and metadata.
      return block(item) as unknown as typeof item;
    });
    return {
      content,
      ...(event.structuredContent === undefined ? {} : { structuredContent: structured(event) }),
      details: event.details,
      isError: event.isError,
      ...(event.usage === undefined ? {} : { usage: event.usage }),
    };
  } catch {
    // Never serialize rejected payloads or exception messages. Replacing content
    // without structuredContent makes Pi drop the unsafe programmatic result.
    return {
      content: [{ type: "text", text: "Tool result rejected: cannot safely redact supported result data." }],
      details: event.details,
      isError: true,
      ...(event.usage === undefined ? {} : { usage: event.usage }),
    };
  }
}
