import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { buildSessionProjection, type SessionEntry, type SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { hasFullCoverage, mergeRanges } from "../../../src/optimizer/deduplicator/helpers.js";
import { getResourceCoverage } from "../../../src/optimizer/deduplicator/resources.js";
import { buildDeduplicatorState } from "../../../src/optimizer/deduplicator/state.js";
import type { Range } from "../../../src/optimizer/inspector/types.js";
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

function result(toolCallId: string, overrides: Partial<ToolResultMessage> = {}): ToolResultMessage {
  return {
    role: "toolResult", toolName: "read", toolCallId,
    content: [{ type: "text", text: "first\nsecond" }], isError: false, timestamp: 0,
    ...overrides,
  };
}

function exchange(
  id: string,
  parentId: string | null,
  range: Range,
  overrides: Partial<ToolResultMessage> = {},
  path = "source.ts",
) {
  const message = assistantMessage("");
  message.content = [{
    type: "toolCall", id, name: overrides.toolName ?? "read",
    arguments: { path, offset: range[0], limit: range[1] - range[0] + 1 },
  }];
  const call = {
    type: "message", id: `${id}-call`, parentId, timestamp: "2025-01-01T00:00:00.000Z", message,
  } satisfies SessionMessageEntry;
  const response = {
    type: "message", id: `${id}-result`, parentId: call.id, timestamp: call.timestamp,
    message: result(id, {
      content: [{ type: "text", text: Array.from({ length: range[1] - range[0] + 1 }, () => "line").join("\n") }],
      ...overrides,
    }),
  } satisfies SessionMessageEntry;
  return [call, response];
}

function candidates(entries: SessionEntry[], leafId: string | null, cwd: string) {
  return buildDeduplicatorState(buildSessionProjection(entries, leafId).entries, cwd);
}

describe("line coverage", () => {
  it("merges overlapping, nested and adjacent ranges without mutating inputs", () => {
    const ranges: Range[] = [[8, 10], [2, 4], [4, 7], [3, 3], [13, 14]];
    const original = structuredClone(ranges);

    expect(mergeRanges(ranges)).toEqual([[2, 10], [13, 14]]);
    expect(ranges).toEqual(original);
    expect(mergeRanges([])).toEqual([]);
  });

  it.each<{ name: string; candidates: Range[]; covered: boolean }>([
    { name: "adjacent pieces", candidates: [[4, 6], [7, 9]], covered: true },
    { name: "surrounding range", candidates: [[1, 20]], covered: true },
    { name: "overlaps clipped to requested lines", candidates: [[1, 6], [5, 20]], covered: true },
    { name: "interior gap", candidates: [[4, 6], [8, 9]], covered: false },
    { name: "missing first line", candidates: [[5, 9]], covered: false },
    { name: "missing last line", candidates: [[4, 8]], covered: false },
    { name: "outside ranges", candidates: [[1, 3], [10, 20]], covered: false },
    { name: "no ranges", candidates: [], covered: false },
  ])("recognizes $name", ({ candidates, covered }) => {
    expect(hasFullCoverage([4, 9], candidates)).toBe(covered);
  });
});

describe("resource coverage", () => {
  it("counts visible read lines rather than requested limit or continuation notice", () => {
    const cwd = workspace();
    const coverage = getResourceCoverage("read", { path: "source.ts", offset: 5, limit: 100 }, result("read", {
      content: [{ type: "text", text: "first\nsecond\n\n[98 more lines. Use offset=7 to continue.]" }],
    }), cwd);

    expect(coverage).toEqual({ resource: join(cwd, "source.ts"), range: [5, 6] });
  });

  it("uses truncation outputLines so metadata cannot inflate retained coverage", () => {
    const cwd = workspace();
    expect(getResourceCoverage("read", { path: "source.ts", offset: 10 }, result("read", {
      content: [{ type: "text", text: "line\nline\nnotice" }],
      details: { truncation: { truncated: true, outputLines: 2 } },
    }), cwd)?.range).toEqual([10, 11]);
  });

  it.each([0, -1, 1.5, "2", null])("rejects invalid read offset %s", (offset) => {
    expect(getResourceCoverage("read", { path: "source.ts", offset }, result("read"), workspace())).toBeUndefined();
  });

  it.each<Partial<ToolResultMessage>>([
    { details: { truncation: "invalid" } },
    { details: { truncation: { firstLineExceedsLimit: true } } },
    { details: { truncation: { truncated: true, outputLines: 0 } } },
    { details: { truncation: { truncated: true, outputLines: 1.5 } } },
    { details: { truncation: { truncated: true } } },
    { content: [{ type: "image", data: "", mimeType: "image/png" }] },
    { content: [{ type: "text", text: "one" }, { type: "text", text: "two" }] },
  ])("does not claim coverage for ambiguous or unreadable read output %#", (overrides) => {
    expect(getResourceCoverage("read", { path: "source.ts" }, result("read", overrides), workspace())).toBeUndefined();
  });

  it("uses inspect source ranges and resolves symlink aliases to same resource", () => {
    const cwd = workspace();
    writeFileSync(join(cwd, "source.ts"), "source");
    symlinkSync(join(cwd, "source.ts"), join(cwd, "alias.ts"));

    const inspected = getResourceCoverage("inspect", { path: "ignored.ts" }, result("inspect", {
      details: { path: "alias.ts", symbol: "handler", range: [20, 30] },
    }), cwd);
    const read = getResourceCoverage("read", { path: "./source.ts", offset: 20 }, result("read"), cwd);

    expect(inspected).toEqual({ resource: join(cwd, "source.ts"), range: [20, 30] });
    expect(read?.resource).toBe(inspected?.resource);
  });

  it.each<Partial<ToolResultMessage>>([
    {},
    { details: { path: "source.ts", symbol: "handler", range: [5, 4] } },
    { details: { path: "source.ts", range: [1, 2] } },
  ])("retains inspect output without valid source metadata %#", (overrides) => {
    expect(getResourceCoverage("inspect", { path: "source.ts" }, result("inspect", overrides), workspace())).toBeUndefined();
  });
});

describe("deduplicator state", () => {
  it("replaces an old range with multiple newer pieces only when every line survives", () => {
    const cwd = workspace();
    const first = exchange("old", null, [1, 4]);
    const next = exchange("next", "old-result", [1, 2]);
    const last = exchange("last", "next-result", [3, 4]);

    const state = candidates([...first, ...next, ...last], "last-result", cwd);

    expect([...state.keys()]).toEqual(["old-result"]);
    expect(new Set(state.get("old-result"))).toEqual(new Set(["last-result", "next-result"]));
    expect(candidates([...first, ...next], "next-result", cwd).size).toBe(0);
  });

  it("points replacement chains at retained results, never another removed duplicate", () => {
    const entries = [
      ...exchange("first", null, [1, 2]),
      ...exchange("second", "first-result", [1, 2]),
      ...exchange("last", "second-result", [1, 2]),
    ];

    expect(candidates(entries, "last-result", workspace())).toEqual(new Map([
      ["first-result", ["last-result"]], ["second-result", ["last-result"]],
    ]));
  });

  it.each<"read" | "inspect">(["read", "inspect"])("allows newer %s output to replace older inspect coverage", (toolName) => {
    const entries = [
      ...exchange("old", null, [10, 11], { toolName: "inspect", details: { path: "source.ts", symbol: "handler", range: [10, 11] } }),
      ...exchange("new", "old-result", [10, 11], {
        toolName, ...(toolName === "inspect" ? { details: { path: "source.ts", symbol: "handler", range: [10, 11] } } : {}),
      }),
    ];

    expect(candidates(entries, "new-result", workspace())).toEqual(new Map([["old-result", ["new-result"]]]));
  });

  it("retains broad reads when newer inspect only covers one symbol", () => {
    const entries = [
      ...exchange("read", null, [1, 10]),
      ...exchange("inspect", "read-result", [3, 4], { toolName: "inspect", details: { path: "source.ts", symbol: "handler", range: [3, 4] } }),
    ];

    expect(candidates(entries, "inspect-result", workspace()).size).toBe(0);
  });

  it("does not use errors, other files or sibling branches as replacement coverage", () => {
    const entries = [
      ...exchange("old", null, [1, 2]),
      ...exchange("failed", "old-result", [1, 2], { isError: true }),
      ...exchange("other-file", "failed-result", [1, 2], {}, "other.ts"),
      ...exchange("sibling", "old-result", [1, 2]),
    ];
    const state = candidates(entries, "other-file-result", workspace());

    expect(state.size).toBe(0);
  });

  it("does not optimize an intentionally empty branch", () => {
    const entries = [...exchange("old", null, [1, 2]), ...exchange("new", "old-result", [1, 2])];
    expect(candidates(entries, null, workspace()).size).toBe(0);
  });

  it.each([null, { content: "short summary" }])(
    "retains an old range when a newer covering piece is omitted or replaced (%j)",
    (replacement) => {
      const entries: SessionEntry[] = [
        ...exchange("old", null, [1, 4]),
        ...exchange("next", "old-result", [1, 2]),
        ...exchange("last", "next-result", [3, 4]),
        { type: "context_edit", id: "edit", parentId: "last-result", timestamp: "2025-01-01T00:00:00.000Z",
          targetId: "last-result", replacement },
      ];
      expect(candidates(entries, "edit", workspace()).size).toBe(0);
    },
  );

  it("does not trust inspect range metadata on a replaced result", () => {
    const entries: SessionEntry[] = [
      ...exchange("old", null, [10, 13]),
      ...exchange("new", "old-result", [10, 13], {
        toolName: "inspect", details: { path: "source.ts", symbol: "handler", range: [10, 13] },
      }),
      { type: "context_edit", id: "edit", parentId: "new-result", timestamp: "2025-01-01T00:00:00.000Z",
        targetId: "new-result", replacement: { content: "short summary" } },
    ];
    expect(candidates(entries, "edit", workspace()).size).toBe(0);
  });
});
