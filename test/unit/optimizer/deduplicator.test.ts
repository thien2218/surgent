import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { buildSessionProjection, type SessionEntry, type SessionMessageEntry } from "@earendil-works/pi-coding-agent";
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

function exchange(id: string, parentId: string | null, overrides: Partial<ToolResultMessage> = {}) {
  const message = assistantMessage("");
  message.content = [{
    type: "toolCall", id, name: overrides.toolName ?? "inspect",
    arguments: { path: "input.ts", symbol: "requested" },
  }];
  const call = {
    type: "message", id: `${id}-call`, parentId, timestamp: "2025-01-01T00:00:00.000Z", message,
  } satisfies SessionMessageEntry;
  const response = {
    type: "message", id: `${id}-result`, parentId: call.id, timestamp: call.timestamp,
    message: {
      role: "toolResult", toolName: "inspect", toolCallId: id,
      content: [{ type: "text", text: "source" }], isError: false, timestamp: 0,
      details: { path: "source.ts", symbol: "handler" },
      ...overrides,
    },
  } satisfies SessionMessageEntry;
  return [call, response];
}

function candidates(entries: SessionEntry[], leafId: string | null, cwd: string) {
  return buildDeduplicatorState(buildSessionProjection(entries, leafId).entries, cwd);
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
    { path: "source.ts", symbol: "handler " },
    { path: "other.ts", symbol: "handler" },
  ])("keeps distinct returned identities despite matching inputs (%j)", (details) => {
    const entries = [...exchange("old", null), ...exchange("new", "old-result", { details })];
    expect(candidates(entries, "new-result", workspace()).size).toBe(0);
  });

  it("normalizes relative, absolute, and symlink aliases", () => {
    const cwd = workspace();
    writeFileSync(join(cwd, "source.ts"), "source");
    symlinkSync(join(cwd, "source.ts"), join(cwd, "alias.ts"));
    const entries = [
      ...exchange("first", null),
      ...exchange("second", "first-result", { details: { path: "./alias.ts", symbol: "handler" } }),
      ...exchange("last", "second-result", { details: { path: join(cwd, "source.ts"), symbol: "handler" } }),
    ];

    expect(candidates(entries, "last-result", cwd)).toEqual(new Set(["first-result", "second-result"]));
  });

  it("normalizes unavailable paths when hiding older duplicates", () => {
    const entries = [
      ...exchange("first", null),
      ...exchange("second", "first-result", { details: { path: "./folder/../source.ts", symbol: "handler" } }),
      ...exchange("last", "second-result"),
    ];

    expect(candidates(entries, "last-result", workspace())).toEqual(new Set(["first-result", "second-result"]));
  });

  it("keeps file and symbol boundaries unambiguous", () => {
    const entries = [
      ...exchange("old", null, { details: { path: "source.ts:part", symbol: "handler" } }),
      ...exchange("new", "old-result", { details: { path: "source.ts", symbol: "part:handler" } }),
    ];
    expect(candidates(entries, "new-result", workspace()).size).toBe(0);
  });

  it.each([
    ["read", "read"], ["read", "inspect"], ["inspect", "read"],
  ])("never uses reads for deduplication (%s then %s)", (older, newer) => {
    const entries = [
      ...exchange("old", null, { toolName: older }),
      ...exchange("new", "old-result", { toolName: newer }),
    ];
    expect(candidates(entries, "new-result", workspace()).size).toBe(0);
  });

  it.each<Partial<ToolResultMessage>>([
    { isError: true },
    { details: undefined },
    { details: null },
    { details: {} },
    { details: { path: "", symbol: "handler" } },
    { details: { path: "source.ts", symbol: "" } },
    { details: { path: 5, symbol: "handler" } },
    { details: { path: "source.ts", symbol: 5 } },
    { details: { path: "source.ts" } },
    { details: { symbol: "handler" } },
  ])("does not let ineligible results supersede valid identities (%j)", (overrides) => {
    const entries = [
      ...exchange("first", null),
      ...exchange("second", "first-result"),
      ...exchange("invalid", "second-result", overrides),
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
      ...exchange("other", "old-result", { details: { path: "other.ts", symbol: "handler" } }),
      ...exchange("sibling", "old-result"),
    ];
    const cwd = workspace();
    expect(candidates(entries, "other-result", cwd).size).toBe(0);
    expect(candidates(entries, "sibling-result", cwd)).toEqual(new Set(["old-result"]));
    expect(candidates(entries, null, cwd).size).toBe(0);
  });
});
