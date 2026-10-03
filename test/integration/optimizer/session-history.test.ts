import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { readSessionEntries } from "../../../src/optimizer/entries.js";
import { buildDeduplicatorState } from "../../../src/optimizer/deduplicator/state.js";
import { rewritePrunedSessionFile } from "../../../src/optimizer/pruner/session.js";
import { assistantMessage } from "../../helpers/commands.js";

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "surgent-history-"));
  onTestFinished(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });
  vi.stubEnv("HOME", root);
  vi.stubEnv("USERPROFILE", root);
  vi.stubEnv("PI_OFFLINE", "1");
  return root;
}

function appendRead(manager: SessionManager, toolCallId: string, isError = false) {
  const assistant = assistantMessage("");
  assistant.content = [{ type: "toolCall", id: toolCallId, name: "read", arguments: { path: "source.ts" } }];
  const callId = manager.appendMessage(assistant);
  const message: ToolResultMessage = {
    role: "toolResult", toolCallId, toolName: "read", isError, timestamp: 0,
    content: [{ type: "text", text: isError ? "missing file" : "source line" }],
  };
  const resultId = manager.appendMessage(message);
  return { callId, resultId };
}

describe("persisted optimizer history", () => {
  it("reopens repaired Pi history without losing sibling branches or using their coverage", () => {
    const cwd = workspace();
    const sessions = join(cwd, "sessions");
    const manager = SessionManager.create(cwd, sessions);
    const rootId = manager.appendMessage({ role: "user", content: "request", timestamp: 0 });
    const failed = appendRead(manager, "failed", true);
    const old = appendRead(manager, "old");
    const replyId = manager.appendMessage(assistantMessage("retained reply"));
    manager.branch(old.resultId);
    const newer = appendRead(manager, "newer");
    manager.appendLabelChange(failed.resultId, "bookmark");
    const file = manager.getSessionFile()!;

    rewritePrunedSessionFile(file, replyId, false);

    const reopened = SessionManager.open(file, sessions, cwd);
    expect(reopened.getEntry(failed.callId)).toBeUndefined();
    expect(reopened.getEntry(failed.resultId)).toBeUndefined();
    expect(reopened.getBranch(replyId).map((entry) => entry.id)).toEqual([rootId, old.callId, old.resultId, replyId]);
    expect(reopened.getBranch(newer.resultId).map((entry) => entry.id)).toEqual([
      rootId, old.callId, old.resultId, newer.callId, newer.resultId,
    ]);
    expect(reopened.getLabel(rootId)).toBe("bookmark");

    const persisted = readSessionEntries(file)!;
    expect(buildDeduplicatorState(persisted, replyId, cwd).replacements.size).toBe(0);
    expect(buildDeduplicatorState(persisted, newer.resultId, cwd).replacements).toEqual(new Map([["old", [newer.resultId]]]));
    const rewritten = readFileSync(file, "utf8");
    rewritePrunedSessionFile(file, replyId, false);
    expect(readFileSync(file, "utf8")).toBe(rewritten);
    expect(readdirSync(sessions)).toEqual([file.slice(sessions.length + 1)]);
  });

  it("rewrites failed turns on inactive branches too, without discarding healthy active history", () => {
    const cwd = workspace();
    const sessions = join(cwd, "sessions");
    const manager = SessionManager.create(cwd, sessions);
    const rootId = manager.appendMessage({ role: "user", content: "request", timestamp: 0 });
    const healthyId = manager.appendMessage(assistantMessage("active response"));
    manager.branch(rootId);
    const failed = appendRead(manager, "failed", true);
    const file = manager.getSessionFile()!;

    rewritePrunedSessionFile(file, healthyId, false);

    const reopened = SessionManager.open(file, sessions, cwd);
    expect(reopened.getBranch(healthyId).map((entry) => entry.id)).toEqual([rootId, healthyId]);
    expect(reopened.getEntry(failed.resultId)).toBeUndefined();
    expect(reopened.getEntry(failed.callId)).toBeUndefined();
  });

  it.each(["{broken", "null", "[]", "false"])(
    "leaves malformed persisted file byte-for-byte untouched (%s)",
    (invalid) => {
      const root = workspace();
      const file = join(root, "session.jsonl");
      const original = [
        '{"type":"session","version":3}',
        JSON.stringify({ type: "message", id: "failed", parentId: null, message: {
          role: "toolResult", toolCallId: "failed", toolName: "read", isError: true,
          content: [{ type: "text", text: "failure" }], timestamp: 0,
        } satisfies ToolResultMessage }),
        invalid,
        "",
      ].join("\n");
      writeFileSync(file, original);

      rewritePrunedSessionFile(file, "failed", true);

      expect(readFileSync(file, "utf8")).toBe(original);
      expect(readdirSync(root)).toEqual(["session.jsonl"]);
    },
  );

  it("does not rewrite healthy history merely to normalize JSON formatting", () => {
    const root = workspace();
    const file = join(root, "session.jsonl");
    const original = '  {"type":"session", "version":3}\n\n{"type":"message", "id":"root", "message":{"role":"user", "content":"keep"}}';
    writeFileSync(file, original);

    rewritePrunedSessionFile(file, null, true);

    expect(readFileSync(file, "utf8")).toBe(original);
    expect(readdirSync(root)).toEqual(["session.jsonl"]);
  });
});
