import { describe, expect, it } from "vitest";
import { normalizeServerConfig } from "../../../src/mcp-client/storage.js";
import { parseEditConfigValues } from "../../../src/mcp-client/validation.js";

describe("MCP config normalization", () => {
  it.each([
    { command: " node " },
    { type: "stdio", command: " node " },
    { transport: "stdio", command: " node " },
  ])("infers or accepts stdio and defaults it to disabled: %j", (config) => {
    expect(normalizeServerConfig("fixture", config)).toEqual({ transport: "stdio", command: "node", enabled: false });
  });

  it.each([undefined, "http", "https"])("accepts remote legacy type %s", (type) => {
    expect(normalizeServerConfig("fixture", { type, url: " http://localhost/mcp " }))
      .toEqual({ transport: "http", url: "http://localhost/mcp", enabled: false });
  });

  it("preserves explicit local options and strips editor-only fields", () => {
    expect(normalizeServerConfig("fixture", {
      name: "fixture", scope: "global", command: " node ", enabled: true,
      description: " fixture ", cwd: " /workspace ", args: ["--flag", " spaced "], env: { FIXTURE: "value" },
    })).toEqual({
      transport: "stdio", command: "node", enabled: true, description: "fixture",
      cwd: "/workspace", args: ["--flag", " spaced "], env: { FIXTURE: "value" },
    });
  });

  it("preserves remote headers without retaining local transport fields", () => {
    expect(normalizeServerConfig("fixture", {
      transport: "http", url: "http://localhost/mcp", enabled: true, headers: { Authorization: "Bearer fake-token" }, command: "unused",
    })).toEqual({ transport: "http", url: "http://localhost/mcp", enabled: true, headers: { Authorization: "Bearer fake-token" } });
  });

  it.each([
    [null, "expected an object"],
    [[], "expected an object"],
    [{}, "include either command"],
    [{ transport: "sse" }, "transport/type"],
    [{ command: " " }, "command"],
    [{ transport: "http", url: "" }, "url"],
    [{ command: "node", enabled: "true" }, "enabled"],
    [{ command: "node", description: false }, "description"],
    [{ command: "node", cwd: " " }, "cwd"],
    [{ command: "node", args: "[]" }, "args"],
    [{ command: "node", args: [1] }, "args"],
    [{ command: "node", env: [] }, "env"],
    [{ command: "node", env: { FIXTURE: 1 } }, "env.FIXTURE"],
    [{ url: "http://localhost/mcp", headers: { Authorization: false } }, "headers.Authorization"],
  ])("rejects malformed config %j", (config, message) => {
    expect(() => normalizeServerConfig("fixture", config)).toThrow(String(message));
  });
});

describe("MCP editor parsing", () => {
  const local = { name: "fixture", scope: "project", transport: "stdio", enabled: "false", command: "node" };
  const remote = { name: "fixture", scope: "global", transport: "http", enabled: "true", url: "http://localhost/mcp" };

  it("trims fields and parses local JSON options and case-insensitive booleans", () => {
    expect(parseEditConfigValues({
      ...local, name: " fixture ", command: " node ", enabled: " TRUE ", description: " demo ",
      cwd: " /workspace ", args: '["--flag"]', env: '{"FIXTURE":"fake-value"}',
    })).toEqual({
      name: "fixture", scope: "project", transport: "stdio", enabled: true, command: "node", description: "demo",
      cwd: "/workspace", args: ["--flag"], env: { FIXTURE: "fake-value" },
    });
  });

  it("parses remote headers and omits blank optional fields", () => {
    expect(parseEditConfigValues({ ...remote, description: " ", headers: '{"Authorization":"Bearer fake-token"}' }))
      .toEqual({ ...remote, enabled: true, headers: { Authorization: "Bearer fake-token" } });
    expect(parseEditConfigValues({ ...local, enabled: " FALSE ", args: " ", env: "", cwd: "", description: "" }))
      .toEqual({ ...local, enabled: false });
  });

  it.each(["", "yes", "1"])("rejects non-boolean enabled text %j", (enabled) => {
    expect(() => parseEditConfigValues({ ...local, enabled })).toThrow('enabled must be "true" or "false"');
  });

  it.each<Record<string, string>>([
    { name: " " }, { scope: "elsewhere" }, { command: " " }, { args: "[1]" }, { env: '{"FIXTURE":false}' },
  ])("rejects invalid local form values %j", (values) => {
    expect(() => parseEditConfigValues({ ...local, ...values })).toThrow("Invalid");
  });

  it.each<Record<string, string>>([{ url: " " }, { headers: "[]" }, { headers: '{"Authorization":1}' }])("rejects invalid remote form values %j", (values) => {
    expect(() => parseEditConfigValues({ ...remote, ...values })).toThrow("Invalid");
  });

  it.each(["args", "env"])("identifies invalid JSON field %s", (field) => {
    expect(() => parseEditConfigValues({ ...local, [field]: "{" })).toThrow(`Invalid JSON in ${field}`);
  });

  it("rejects malformed header JSON and unsupported transport", () => {
    expect(() => parseEditConfigValues({ ...remote, headers: "{" })).toThrow("Invalid JSON in headers");
    expect(() => parseEditConfigValues({ ...local, transport: "sse" })).toThrow('transport must be "stdio" or "http"');
  });
});
