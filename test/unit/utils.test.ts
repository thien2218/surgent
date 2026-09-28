import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readJson } from "../../src/utils.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "surgent-json-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
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
