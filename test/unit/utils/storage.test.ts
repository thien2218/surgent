import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPiPath, readJson, writeJson } from "../../../src/utils.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "surgent-json-"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe("Pi paths", () => {
  it.each([
    ["web", "web-results"], ["agents", "agents"], ["settings", "settings.json"],
    ["mcp", "mcp.json"], ["permissions", "permissions.json"], ["checkpoints", "checkpoints"],
    ["subsessions", "subsessions.json"], ["subsessionsDir", "subsessions"],
    ["plans", "plans"], ["grammars", "grammars"], ["system", "SYSTEM.md"],
  ] as const)("places %s under the project Pi directory", (key, name) => {
    expect(getPiPath(key, root)).toBe(join(root, ".pi", name));
  });

  it.each([undefined, "", "global"])("uses the isolated home for global scope %j", (scope) => {
    vi.stubEnv("HOME", root);
    vi.stubEnv("USERPROFILE", root);

    const path = scope === undefined ? getPiPath("settings") : getPiPath("settings", scope);

    expect(path).toBe(join(root, ".pi", "agent", "settings.json"));
  });

  it("appends directory children but never appends to configuration file paths", () => {
    expect(getPiPath("agents", root, "nested", "reviewer.md"))
      .toBe(join(root, ".pi", "agents", "nested", "reviewer.md"));
    expect(getPiPath("settings", root, "ignored")).toBe(join(root, ".pi", "settings.json"));
  });
});

describe("JSON file writes", () => {
  it("replaces existing data with formatted JSON and a final newline", async () => {
    const path = join(root, "settings.json");
    await writeFile(path, "obsolete content");

    await writeJson(path, { enabled: false });

    await expect(readFile(path, "utf8")).resolves.toBe('{\n  "enabled": false\n}\n');
  });

  it("preserves existing data when serialization fails", async () => {
    const path = join(root, "settings.json");
    await writeFile(path, "preserve");

    await expect(writeJson(path, { value: 1n })).rejects.toThrow(TypeError);
    await expect(readFile(path, "utf8")).resolves.toBe("preserve");
  });

  it("propagates write failures without creating missing parent directories", async () => {
    const path = join(root, "missing", "settings.json");

    await expect(writeJson(path, {})).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("JSON file reads", () => {
  it("returns the supplied fallback when the file is missing", async () => {
    const fallback = {};

    await expect(readJson(join(root, "missing.json"), fallback)).resolves.toBe(fallback);
  });

  it("returns parsed data instead of the fallback for an existing file", async () => {
    const path = join(root, "settings.json");
    await writeFile(path, '{"enabled":false,"items":[],"optional":null}');

    await expect(readJson(path, {})).resolves.toEqual({ enabled: false, items: [], optional: null });
  });

  it.each(["null", "[]", "[{}]", "42", '\"\"', "true"])("rejects non-record JSON %s without changing the file", async (content) => {
    const path = join(root, "settings.json");
    await writeFile(path, content);

    await expect(readJson(path, {})).rejects.toThrow("Expected JSON object");
    await expect(readFile(path, "utf8")).resolves.toBe(content);
  });

  it.each(["", "not-json"])("rejects malformed JSON %j without changing the file", async (content) => {
    const path = join(root, "settings.json");
    await writeFile(path, content);

    await expect(readJson(path, {})).rejects.toThrow(SyntaxError);
    await expect(readFile(path, "utf8")).resolves.toBe(content);
  });

  it("propagates read errors other than a missing file", async () => {
    const path = join(root, "not-a-directory");
    await writeFile(path, "test");

    await expect(readJson(join(path, "settings.json"), {})).rejects.toMatchObject({ code: "ENOTDIR" });
  });
});
