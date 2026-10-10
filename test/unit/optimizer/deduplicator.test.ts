import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { SessionManager, type SessionEntry, type SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { buildDeduplicatorState } from "../../../src/optimizer/deduplicator/state.js";
import { assistantMessage } from "../../helpers/commands.js";

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "surgent-deduplicator-"));
  onTestFinished(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });
  vi.stubEnv("HOME", root);
  vi.stubEnv("USERPROFILE", root);
  return root;
}

function exchange(
  id: string,
  parentId: string | null,
  overrides: Partial<ToolResultMessage> = {},
  args: ToolCall["arguments"] = { path: "source.ts", symbol: "handler" },
) {
  const message = assistantMessage("");
  message.content = [{
    type: "toolCall", id, name: overrides.toolName ?? "inspect",
    arguments: args,
  }];
  const call = {
    type: "message", id: `${id}-call`, parentId, timestamp: "2025-01-01T00:00:00.000Z", message,
  } satisfies SessionMessageEntry;
  const response = {
    type: "message", id: `${id}-result`, parentId: call.id, timestamp: call.timestamp,
    message: {
      role: "toolResult", toolName: "inspect", toolCallId: id,
      content: [{ type: "text", text: "source" }], isError: false, timestamp: 0,
      details: null,
      ...overrides,
    },
  } satisfies SessionMessageEntry;
  return [call, response] satisfies [typeof call, typeof response];
}

function candidates(entries: SessionEntry[], leafId: string | null, cwd: string) {
  const manager = SessionManager.inMemory(cwd, undefined, entries);
  if (leafId === null) manager.resetLeaf();
  else manager.branch(leafId);
  return buildDeduplicatorState(manager.buildSessionProjection().entries, manager.getBranch(), cwd);
}

describe("inspect identity deduplication", () => {
  it("keeps the newest body for a matching file and symbol", () => {
    const entries = [
      ...exchange("old", null),
      ...exchange("new", "old-result", {
        content: [{ type: "text", text: "changed source" }],
      }),
    ];

    expect(candidates(entries, "new-result", workspace())).toEqual(new Set(["old-result"]));
  });

  it.each([
    { path: "source.ts", symbol: "other" },
    { path: "source.ts", symbol: "Handler" },
    { path: "other.ts", symbol: "handler" },
  ])("keeps distinct input identities (%j)", (args) => {
    const entries = [...exchange("old", null), ...exchange("new", "old-result", {}, args)];
    expect(candidates(entries, "new-result", workspace()).size).toBe(0);
  });

  it("normalizes relative, absolute, and symlink aliases", () => {
    const cwd = workspace();
    writeFileSync(join(cwd, "source.ts"), "source");
    symlinkSync(join(cwd, "source.ts"), join(cwd, "alias.ts"));
    const entries = [
      ...exchange("first", null),
      ...exchange("second", "first-result", {}, { path: "./alias.ts", symbol: "handler" }),
      ...exchange("last", "second-result", {}, { path: join(cwd, "source.ts"), symbol: "handler" }),
    ];

    expect(candidates(entries, "last-result", cwd)).toEqual(new Set(["first-result", "second-result"]));
  });

  it("normalizes unavailable paths when hiding older duplicates", () => {
    const entries = [
      ...exchange("first", null),
      ...exchange("second", "first-result", {}, { path: "./folder/../source.ts", symbol: "handler" }),
      ...exchange("last", "second-result"),
    ];

    expect(candidates(entries, "last-result", workspace())).toEqual(new Set(["first-result", "second-result"]));
  });

  it("uses trimmed input symbols for deduplication", () => {
    const entries = [
      ...exchange("old", null),
      ...exchange("new", "old-result", {}, { path: "source.ts", symbol: " handler " }),
    ];
    expect(candidates(entries, "new-result", workspace())).toEqual(new Set(["old-result"]));
  });

  it.each([
    ["read", "read"], ["read", "inspect"], ["inspect", "read"],
  ])("does not infer read completeness (%s then %s)", (older, newer) => {
    const entries = [
      ...exchange("old", null, { toolName: older }),
      ...exchange("new", "old-result", { toolName: newer }),
    ];
    expect(candidates(entries, "new-result", workspace()).size).toBe(0);
  });

  it("does not let failed inspections supersede valid identities", () => {
    const entries = [
      ...exchange("first", null),
      ...exchange("second", "first-result"),
      ...exchange("invalid", "second-result", { isError: true }),
    ];
    expect(candidates(entries, "invalid-result", workspace())).toEqual(new Set(["first-result"]));
  });

  it.each([null, { content: "short summary" }])(
    "does not trust identities on omitted or externally replaced results (%j)",
    (replacement) => {
      const entries: SessionEntry[] = [
        ...exchange("first", null),
        ...exchange("second", "first-result"),
        ...exchange("last", "second-result"),
        { type: "context_edit", id: "edit", parentId: "last-result", timestamp: "2025-01-01T00:00:00.000Z",
          targetId: "last-result", replacement },
      ];
      expect(candidates(entries, "edit", workspace())).toEqual(new Set(["first-result"]));
    },
  );

  it("does not remove externally replaced older results", () => {
    const entries: SessionEntry[] = [
      ...exchange("old", null),
      ...exchange("new", "old-result"),
      { type: "context_edit", id: "edit", parentId: "new-result", timestamp: "2025-01-01T00:00:00.000Z",
        targetId: "old-result", replacement: { content: "external summary" } },
    ];
    expect(candidates(entries, "edit", workspace()).size).toBe(0);
  });

  it("uses only the active branch, including an intentionally empty branch", () => {
    const entries = [
      ...exchange("old", null),
      ...exchange("other", "old-result", {}, { path: "other.ts", symbol: "handler" }),
      ...exchange("sibling", "old-result"),
    ];
    const cwd = workspace();
    expect(candidates(entries, "other-result", cwd).size).toBe(0);
    expect(candidates(entries, "sibling-result", cwd)).toEqual(new Set(["old-result"]));
    expect(candidates(entries, null, cwd).size).toBe(0);
  });
});

describe("compaction boundary", () => {
  it("protects kept inspections while deduplicating newer inspections", () => {
    const entries: SessionEntry[] = [
      ...exchange("kept-inspect", null),
      ...exchange("kept-duplicate", "kept-inspect-result"),
      { type: "compaction", id: "compaction", parentId: "kept-duplicate-result",
        timestamp: "2025-01-01T00:00:00.000Z", summary: "Earlier context",
        firstKeptEntryId: "kept-inspect-call", tokensBefore: 1000 },
      ...exchange("active-inspect", "compaction"),
      ...exchange("latest", "active-inspect-result"),
    ];

    expect(candidates(entries, "latest-result", workspace())).toEqual(new Set(["active-inspect-result"]));
  });
});

describe("successful write invalidation", () => {
  it("skips historical assistants with missing content without losing valid candidates", () => {
    const [broken] = exchange("broken", null);
    broken.message.content = undefined as unknown as typeof broken.message.content;
    const entries = [
      broken,
      ...exchange("old", broken.id),
      ...exchange("write", "old-result", { toolName: "write" }, { path: "source.ts" }),
    ];
    expect(candidates(entries, "write-result", workspace())).toEqual(new Set(["old-result"]));
  });

  it("invalidates all older reads and inspected symbols for one file while retaining fresh results", () => {
    const entries = [
      ...exchange("read", null, { toolName: "read", details: undefined }, { path: "source.ts", offset: 1, limit: 5 }),
      ...exchange("range", "read-result", { toolName: "read", details: undefined }, { path: "source.ts", offset: 20, limit: 2 }),
      ...exchange("inspect", "range-result"),
      ...exchange("symbol", "inspect-result", {}, { path: "source.ts", symbol: "other" }),
      ...exchange("unrelated", "symbol-result", { toolName: "read" }, { path: "other.ts" }),
      ...exchange("write", "unrelated-result", { toolName: "write", details: undefined }, { path: "source.ts", content: "changed" }),
      ...exchange("fresh-read", "write-result", { toolName: "read" }, { path: "source.ts" }),
      ...exchange("fresh-inspect", "fresh-read-result"),
    ];

    expect(candidates(entries, "fresh-inspect-result", workspace())).toEqual(new Set([
      "symbol-result", "inspect-result", "range-result", "read-result",
    ]));
  });

  it.each(["relative", "absolute", "symlink", "tilde", "at-prefix", "file-url", "unicode-space"] as const)(
    "matches normalized %s input paths across tools",
    (convention) => {
      const cwd = workspace();
      const path = join(cwd, "source file.ts");
      writeFileSync(path, "source");
      symlinkSync(path, join(cwd, "alias.ts"));
      const inputs = {
        relative: "./source file.ts", absolute: path, symlink: "alias.ts",
        tilde: "~/source file.ts", "at-prefix": "@source file.ts",
        "file-url": pathToFileURL(path).href, "unicode-space": "source\u00a0file.ts",
      };
      const entries = [
        ...exchange("read", null, { toolName: "read", details: undefined }, { path: inputs[convention] }),
        ...exchange("inspect", "read-result", {}, { path, symbol: "handler" }),
        ...exchange("write", "inspect-result", { toolName: "write", details: undefined }, { path: inputs[convention] }),
      ];

      expect(candidates(entries, "write-result", cwd)).toEqual(new Set(["inspect-result", "read-result"]));
    },
  );

  it.each([
    ["Screenshot 12 PM.png", "Screenshot 12\u202fPM.png"],
    ["caf\u00e9.ts", "cafe\u0301.ts"],
    ["Capture d'\u00e9cran.ts", "Capture d\u2019\u00e9cran.ts"],
    ["caf\u00e9 d'\u00e9cran.ts", "cafe\u0301 d\u2019e\u0301cran.ts"],
  ])("uses the built-in read filename fallback for %s", (input, actual) => {
    const cwd = workspace();
    const path = join(cwd, actual);
    writeFileSync(path, "source");
    const entries = [
      ...exchange("read", null, { toolName: "read", details: undefined }, { path: input }),
      ...exchange("write", "read-result", { toolName: "write" }, { path: pathToFileURL(path).href }),
    ];

    expect(candidates(entries, "write-result", cwd)).toEqual(new Set(["read-result"]));
  });

  it("matches missing files using normalized absolute fallback paths", () => {
    const entries = [
      ...exchange("read", null, { toolName: "read" }, { path: "folder/../source.ts" }),
      ...exchange("inspect", "read-result"),
      ...exchange("write", "inspect-result", { toolName: "write" }, { path: "./source.ts" }),
    ];
    expect(candidates(entries, "write-result", workspace())).toEqual(new Set(["inspect-result", "read-result"]));
  });

  it.each<{ name: string; toolName: string; isError: boolean; args: ToolCall["arguments"] }>([
    { name: "failed write", toolName: "write", isError: true, args: { path: "source.ts" } },
    { name: "edit", toolName: "edit", isError: false, args: { path: "source.ts" } },
    { name: "unrelated write", toolName: "write", isError: false, args: { path: "other.ts" } },
    { name: "missing path", toolName: "write", isError: false, args: {} },
    { name: "empty path", toolName: "write", isError: false, args: { path: "" } },
    { name: "invalid path", toolName: "write", isError: false, args: { path: 5 } },
    { name: "invalid file URL", toolName: "write", isError: false, args: { path: "file://%" } },
  ])("does not invalidate results after $name", ({ toolName, isError, args }) => {
    const entries = [
      ...exchange("read", null, { toolName: "read" }, { path: "source.ts" }),
      ...exchange("inspect", "read-result"),
      ...exchange("mutation", "inspect-result", { toolName, isError }, args),
    ];
    expect(candidates(entries, "mutation-result", workspace()).size).toBe(0);
  });

  it.each(["missing", "ambiguous", "mismatched", "later", "missing-arguments"])(
    "does not trust a write with %s call association",
    (association) => {
      const [call, result] = exchange("write", "old-result", { toolName: "write" }, { path: "source.ts" });
      const entries: SessionEntry[] = exchange("old", null);
      if (association === "missing") entries.push({ ...result, parentId: "old-result" });
      if (association === "ambiguous") {
        entries.push(call, { ...call, id: "duplicate-call", parentId: call.id }, { ...result, parentId: "duplicate-call" });
      }
      if (association === "mismatched") {
        call.message.content = [{ type: "toolCall", id: "write", name: "read", arguments: { path: "source.ts" } }];
        entries.push(call, result);
      }
      if (association === "later") {
        entries.push({ ...result, parentId: "old-result" }, { ...call, parentId: result.id });
      }
      if (association === "missing-arguments") {
        call.message.content = [{ type: "toolCall", id: "write", name: "write", arguments: undefined as unknown as ToolCall["arguments"] }];
        entries.push(call, result);
      }
      expect(candidates(entries, entries.at(-1)!.id, workspace()).size).toBe(0);
    },
  );

  it.each([null, { content: "external call summary" }])("uses successful writes even when their projected call is replaced (%j)", (replacement) => {
    const entries: SessionEntry[] = [
      ...exchange("old-write", null, { toolName: "write" }, { path: "source.ts", content: "old" }),
      ...exchange("old-edit", "old-write-result", { toolName: "edit" }, { path: "source.ts", edits: [{ oldText: "old", newText: "edited" }] }),
      ...exchange("old-read", "old-edit-result", { toolName: "read" }, { path: "source.ts" }),
      ...exchange("old-inspect", "old-read-result"),
      ...exchange("write", "old-inspect-result", { toolName: "write" }, { path: "source.ts", content: "current" }),
      { type: "context_edit", id: "replacement", parentId: "write-result", timestamp: "2025-01-01T00:00:00.000Z", targetId: "write-call", replacement },
    ];
    expect(candidates(entries, "replacement", workspace())).toEqual(new Set([
      "old-write-result", "old-edit-result", "old-read-result", "old-inspect-result",
    ]));
  });

  it("protects omitted and externally replaced reads and inspections from invalidation", () => {
    const entries: SessionEntry[] = [
      ...exchange("read", null, { toolName: "read" }, { path: "source.ts" }),
      ...exchange("inspect", "read-result"),
      ...exchange("write", "inspect-result", { toolName: "write" }, { path: "source.ts" }),
      { type: "context_edit", id: "read-edit", parentId: "write-result", timestamp: "2025-01-01T00:00:00.000Z", targetId: "read-result", replacement: { content: "external read summary" } },
      { type: "context_edit", id: "inspect-edit", parentId: "read-edit", timestamp: "2025-01-01T00:00:00.000Z", targetId: "inspect-result", replacement: null },
    ];
    expect(candidates(entries, "inspect-edit", workspace()).size).toBe(0);
  });

  it("ignores writes on inactive branches", () => {
    const entries = [
      ...exchange("old", null),
      ...exchange("write", "old-result", { toolName: "write" }, { path: "source.ts" }),
      ...exchange("active", "old-result", { toolName: "bash" }),
    ];
    const cwd = workspace();
    expect(candidates(entries, "active-result", cwd).size).toBe(0);
    expect(candidates(entries, "write-result", cwd)).toEqual(new Set(["old-result"]));
  });
});

describe("file snapshot invalidation", () => {
  it.each(["write", "read"])("uses a newer %s to replace older observations and mutations", (toolName) => {
    const cwd = workspace();
    writeFileSync(join(cwd, "source.ts"), "current");
    symlinkSync(join(cwd, "source.ts"), join(cwd, "alias.ts"));
    const entries = [
      ...exchange("old-write", null, { toolName: "write" }, { path: pathToFileURL(join(cwd, "source.ts")).href, content: "old" }),
      ...exchange("old-edit", "old-write-result", { toolName: "edit" }, { path: "alias.ts", edits: [{ oldText: "old", newText: "edited" }] }),
      ...exchange("old-read", "old-edit-result", { toolName: "read", details: undefined }, { path: "folder/../source.ts", limit: 1 }),
      ...exchange("old-inspect", "old-read-result"),
      ...exchange("other-edit", "old-inspect-result", { toolName: "edit" }, { path: "other.ts", edits: [{ oldText: "old", newText: "new" }] }),
      ...exchange("snapshot", "other-edit-result", { toolName, details: toolName === "read" ? { fullFile: true } : undefined }, { path: "@./source.ts", content: "current" }),
      ...exchange("fresh-read", "snapshot-result", { toolName: "read", details: undefined }, { path: "source.ts", limit: 1 }),
      ...exchange("fresh-edit", "fresh-read-result", { toolName: "edit" }, { path: "source.ts", edits: [{ oldText: "current", newText: "fresh" }] }),
    ];

    expect(candidates(entries, "fresh-edit-result", cwd)).toEqual(new Set([
      "old-write-result", "old-edit-result", "old-read-result", "old-inspect-result",
    ]));
  });

  it.each<Partial<ToolResultMessage>>([
    { isError: true, details: { fullFile: true } },
    { details: undefined },
    { details: null },
    { details: [] },
    { details: { fullFile: false } },
    { details: { fullFile: "true" } },
  ])("does not treat an unsuccessful or incomplete read as a snapshot (%j)", (overrides) => {
    const entries = [
      ...exchange("write", null, { toolName: "write" }, { path: "source.ts", content: "old" }),
      ...exchange("edit", "write-result", { toolName: "edit" }, { path: "source.ts", edits: [{ oldText: "old", newText: "new" }] }),
      ...exchange("read", "edit-result", { toolName: "read", details: undefined }, { path: "source.ts", limit: 1 }),
      ...exchange("inspect", "read-result"),
      ...exchange("latest", "inspect-result", { toolName: "read", ...overrides }, { path: "source.ts" }),
    ];

    expect(candidates(entries, "latest-result", workspace()).size).toBe(0);
  });

  it("does not let an edit replace prior mutation history", () => {
    const entries = [
      ...exchange("write", null, { toolName: "write" }, { path: "source.ts", content: "old" }),
      ...exchange("old-edit", "write-result", { toolName: "edit" }, { path: "source.ts", edits: [{ oldText: "old", newText: "new" }] }),
      ...exchange("latest", "old-edit-result", { toolName: "edit" }, { path: "source.ts", edits: [{ oldText: "new", newText: "newer" }] }),
    ];
    expect(candidates(entries, "latest-result", workspace()).size).toBe(0);
  });

  it.each([
    { toolName: "write", replacement: null },
    { toolName: "write", replacement: { content: "external summary" } },
    { toolName: "read", replacement: null },
    { toolName: "read", replacement: { content: "external summary" } },
  ])("keeps mutation history when the newest $toolName snapshot is replaced by $replacement", ({ toolName, replacement }) => {
    const entries: SessionEntry[] = [
      ...exchange("old-write", null, { toolName: "write" }, { path: "source.ts", content: "old" }),
      ...exchange("old-edit", "old-write-result", { toolName: "edit" }, { path: "source.ts", edits: [{ oldText: "old", newText: "new" }] }),
      ...exchange("read", "old-edit-result", { toolName: "read", details: undefined }, { path: "source.ts", limit: 1 }),
      ...exchange("inspect", "read-result"),
      ...exchange("snapshot", "inspect-result", { toolName, details: toolName === "read" ? { fullFile: true } : undefined }, { path: "source.ts", content: "current" }),
      { type: "context_edit", id: "replacement", parentId: "snapshot-result", timestamp: "2025-01-01T00:00:00.000Z", targetId: "snapshot-result", replacement },
    ];

    expect(candidates(entries, "replacement", workspace()).size).toBe(0);
  });

  it.each(["write", "read"])("protects pre-compaction mutation history from a newer %s snapshot", (toolName) => {
    const entries: SessionEntry[] = [
      ...exchange("kept-write", null, { toolName: "write" }, { path: "source.ts", content: "old" }),
      ...exchange("kept-edit", "kept-write-result", { toolName: "edit" }, { path: "source.ts", edits: [{ oldText: "old", newText: "new" }] }),
      ...exchange("kept-read", "kept-edit-result", { toolName: "read", details: undefined }, { path: "source.ts" }),
      ...exchange("kept-inspect", "kept-read-result"),
      { type: "compaction", id: "compaction", parentId: "kept-inspect-result", timestamp: "2025-01-01T00:00:00.000Z",
        summary: "Earlier context", firstKeptEntryId: "kept-write-call", tokensBefore: 1000 },
      ...exchange("active-write", "compaction", { toolName: "write" }, { path: "source.ts", content: "active" }),
      ...exchange("active-edit", "active-write-result", { toolName: "edit" }, { path: "source.ts", edits: [{ oldText: "active", newText: "new" }] }),
      ...exchange("active-read", "active-edit-result", { toolName: "read", details: undefined }, { path: "source.ts" }),
      ...exchange("active-inspect", "active-read-result"),
      ...exchange("snapshot", "active-inspect-result", { toolName, details: toolName === "read" ? { fullFile: true } : undefined }, { path: "source.ts", content: "current" }),
    ];

    expect(candidates(entries, "snapshot-result", workspace())).toEqual(new Set([
      "active-write-result", "active-edit-result", "active-read-result", "active-inspect-result",
    ]));
  });
});
