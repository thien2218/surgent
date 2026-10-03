import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import {
  getBranchEntries,
  getLastEntryId,
  readSessionEntries,
  writeSessionEntries,
} from "../../../src/optimizer/entries.js";

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "surgent-entries-"));
  onTestFinished(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });
  vi.stubEnv("HOME", root);
  vi.stubEnv("USERPROFILE", root);
  return root;
}

describe("session entries", () => {
  it("reads complete JSONL records while ignoring blank lines", () => {
    const file = join(workspace(), "session.jsonl");
    writeFileSync(file, '\n{"type":"session","version":3}\n \n{"id":"root","parentId":null}\n');

    expect(readSessionEntries(file)).toEqual([
      { type: "session", version: 3 },
      { id: "root", parentId: null },
    ]);
  });

  it.each(["{broken", "null", "[]", '"text"', "42"])(
    "rejects whole file containing invalid record %s without changing it",
    (invalid) => {
      const root = workspace();
      const file = join(root, "session.jsonl");
      const original = `{"id":"valid"}\n${invalid}\n`;
      writeFileSync(file, original);

      expect(readSessionEntries(file)).toBeUndefined();
      expect(readFileSync(file, "utf8")).toBe(original);
      expect(readdirSync(root)).toEqual(["session.jsonl"]);
    },
  );

  it("treats absent and unreadable sessions as unavailable", () => {
    const root = workspace();

    expect(readSessionEntries(undefined)).toBeUndefined();
    expect(readSessionEntries(join(root, "missing.jsonl"))).toBeUndefined();
    expect(readSessionEntries(root)).toBeUndefined();
  });

  it("replaces file with round-trippable JSONL and leaves no temporary file", () => {
    const root = workspace();
    const file = join(root, "session.jsonl");
    writeFileSync(file, "old content");
    const entries = [{ id: "root", parentId: null, text: "first\nsecond" }];

    writeSessionEntries(file, entries);

    expect(readSessionEntries(file)).toEqual(entries);
    expect(readFileSync(file, "utf8")).toBe(`${JSON.stringify(entries[0])}\n`);
    expect(readdirSync(root)).toEqual(["session.jsonl"]);
  });

  it("removes temporary output after failed replacement without damaging target", () => {
    const root = workspace();
    const target = join(root, "session.jsonl");
    mkdirSync(target);
    writeFileSync(join(target, "sentinel"), "keep");

    expect(() => writeSessionEntries(target, [{ id: "new" }])).toThrow();
    expect(readFileSync(join(target, "sentinel"), "utf8")).toBe("keep");
    expect(readdirSync(root)).toEqual(["session.jsonl"]);
  });
});

describe("session branches", () => {
  it("returns ancestors in history order, not file order, excluding sibling branches", () => {
    const root = { id: "root", parentId: null };
    const chosen = { id: "chosen", parentId: "root" };
    const sibling = { id: "sibling", parentId: "root" };
    const leaf = { id: "leaf", parentId: "chosen" };
    const entries = [leaf, sibling, { type: "session" }, chosen, root];

    expect(getBranchEntries(entries, "leaf")).toEqual([root, chosen, leaf]);
    expect(getBranchEntries(entries, null)).toEqual([]);
    expect(getBranchEntries(entries, "missing")).toEqual([]);
  });

  it("stops at missing ancestors and cycles without duplicating entries", () => {
    const orphan = { id: "orphan", parentId: "missing" };
    const first = { id: "first", parentId: "second" };
    const second = { id: "second", parentId: "first" };

    expect(getBranchEntries([orphan], "orphan")).toEqual([orphan]);
    expect(getBranchEntries([first, second], "first")).toEqual([second, first]);
  });

  it("finds last usable entry ID past headers and malformed IDs", () => {
    expect(getLastEntryId([{ id: "root" }, { id: "leaf" }, { id: "" }, { id: 12 }, {}])).toBe("leaf");
    expect(getLastEntryId([{ type: "session" }, { id: "" }])).toBeNull();
  });
});
