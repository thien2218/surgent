import { appendFile, copyFile, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import type { ContextEvent } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import compactorExtension from "../../../src/optimizer/compactor/index.js";
import { commandContext } from "../../helpers/commands.js";
import { recordExtension } from "../../helpers/extension.js";
import { makePermissionWorkspace, type PermissionWorkspace } from "../../helpers/permission.js";

let workspace: PermissionWorkspace;

beforeEach(async () => {
  workspace = await makePermissionWorkspace("surgent-compactor-contract-", true);
  onTestFinished(() => workspace.restore());
  vi.stubEnv("PI_OFFLINE", "1");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function loadCompactor() {
  const pi = recordExtension();
  const { ctx } = commandContext(workspace.cwd);
  const sessionFile = join(workspace.cwd, "session.jsonl");
  const getSessionFile = vi.spyOn(ctx.sessionManager, "getSessionFile").mockReturnValue(sessionFile);
  compactorExtension(pi.api);
  return { pi, ctx, sessionFile, getSessionFile };
}

function toolMessage(toolCallId: string, text: string, toolName = "grep"): ToolResultMessage {
  return {
    role: "toolResult", toolCallId, toolName,
    content: [{ type: "text", text }],
    isError: false, timestamp: 1,
  };
}

function sessionEntry(message: ToolResultMessage) {
  return { type: "message", id: message.toolCallId, parentId: "parent", message };
}

describe("compactor lifecycle", () => {
  it("keeps active grep results until agent_end and summarizes only completed grep calls", async () => {
    const { pi, ctx } = loadCompactor();
    const completed = toolMessage("completed", "src/file.ts\n7: full source");
    const noMatches = toolMessage("empty", "No matches found");
    const bash = toolMessage("bash", "src/file.ts\n7: bash output", "bash");
    const image: ToolResultMessage = {
      ...toolMessage("image", ""),
      content: [{ type: "image", data: "AA==", mimeType: "image/png" }],
    };
    const messages = [completed, noMatches, bash, image];
    const active: ContextEvent = { type: "context", messages: structuredClone(messages) };
    await pi.event("agent_start")({ type: "agent_start" }, ctx);

    expect(await pi.event("context")(active, ctx)).toBeUndefined();
    expect(active.messages).toEqual(messages);
    await pi.event("agent_end")({ type: "agent_end", messages }, ctx);

    const pending = toolMessage("pending", "src/next.ts\n9: still needed");
    const unrelated = toolMessage("completed", "not grep", "read");
    const next: ContextEvent = { type: "context", messages: structuredClone([...messages, pending, unrelated]) };
    expect(await pi.event("context")(next, ctx)).toEqual({ messages: next.messages });
    expect(next.messages).toEqual([
      { ...completed, content: [{ type: "text", text: "src/file.ts: lines_matched=[7]" }] },
      noMatches, bash, image, pending, unrelated,
    ]);
    expect(completed.content).toEqual([{ type: "text", text: "src/file.ts\n7: full source" }]);

    const unmatched: ContextEvent = { type: "context", messages: [pending] };
    expect(await pi.event("context")(unmatched, ctx)).toBeUndefined();
    expect(unmatched.messages).toEqual([pending]);
  });

  it("does not carry summaries into a new extension runtime", async () => {
    const previous = loadCompactor();
    const message = toolMessage("reused-call", "src/file.ts\n7: source");
    await previous.pi.event("agent_end")({ type: "agent_end", messages: [message] }, previous.ctx);
    const fresh = loadCompactor();
    const context: ContextEvent = { type: "context", messages: [message] };

    expect(await fresh.pi.event("context")(context, fresh.ctx)).toBeUndefined();
    expect(message.content).toEqual([{ type: "text", text: "src/file.ts\n7: source" }]);
  });

  it("persists summaries from multiple turns in both session and fork without touching the existing prefix", async () => {
    const { pi, ctx, sessionFile } = loadCompactor();
    const targetSessionFile = join(workspace.cwd, "fork.jsonl");
    const oldResult = toolMessage("old", "src/old.ts\n1: old source");
    const prefix = ` ${JSON.stringify({ type: "session", version: 3, id: "session", note: "café 🦊" })}\n${JSON.stringify(sessionEntry(oldResult))}\n`;
    await writeFile(sessionFile, prefix);
    await pi.event("agent_start")({ type: "agent_start" }, ctx);

    const first = toolMessage("first", "src/first.ts\n2: first source");
    const firstEntry = sessionEntry(first);
    await appendFile(sessionFile, `${JSON.stringify(firstEntry)}\n`);
    await pi.event("agent_end")({ type: "agent_end", messages: [first] }, ctx);
    await pi.event("agent_start")({ type: "agent_start" }, ctx);

    const second = toolMessage("second", "src/second.ts\n3: second source");
    const secondEntry = sessionEntry(second);
    const pending = sessionEntry(toolMessage("pending", "src/pending.ts\n4: keep raw"));
    const bash = sessionEntry(toolMessage("bash", "keep bash", "bash"));
    const custom = { type: "custom", customType: "note", data: "keep note" };
    await appendFile(sessionFile, [secondEntry, pending, bash, custom].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    await pi.event("agent_end")({ type: "agent_end", messages: [second] }, ctx);
    await copyFile(sessionFile, targetSessionFile);

    await pi.event("session_shutdown")({ type: "session_shutdown", reason: "fork", targetSessionFile }, ctx);

    for (const path of [sessionFile, targetSessionFile]) {
      const saved = await readFile(path);
      expect(saved.subarray(0, Buffer.byteLength(prefix))).toEqual(Buffer.from(prefix));
      expect(saved.subarray(Buffer.byteLength(prefix)).toString().trimEnd().split("\n").map((line) => JSON.parse(line))).toEqual([
        { ...firstEntry, message: { ...first, content: [{ type: "text", text: "src/first.ts: lines_matched=[2]" }] } },
        { ...secondEntry, message: { ...second, content: [{ type: "text", text: "src/second.ts: lines_matched=[3]" }] } },
        pending, bash, custom,
      ]);
    }
    expect((await readdir(workspace.cwd)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it.each(["missing file", "no session"])("persists from byte zero when agent_start has %s", async (initial) => {
    const { pi, ctx, sessionFile, getSessionFile } = loadCompactor();
    if (initial === "no session") getSessionFile.mockReturnValue(undefined);
    await pi.event("agent_start")({ type: "agent_start" }, ctx);
    getSessionFile.mockReturnValue(sessionFile);
    const message = toolMessage("grep", "src/file.ts\n5: source");
    const entry = sessionEntry(message);
    await writeFile(sessionFile, `${JSON.stringify(entry)}\n`);
    await pi.event("agent_end")({ type: "agent_end", messages: [message] }, ctx);

    await pi.event("session_shutdown")({ type: "session_shutdown", reason: "quit" }, ctx);

    expect(JSON.parse(await readFile(sessionFile, "utf8"))).toEqual({
      ...entry, message: { ...message, content: [{ type: "text", text: "src/file.ts: lines_matched=[5]" }] },
    });
  });

  it("leaves sessions unchanged when no completed grep has a summary", async () => {
    const { pi, ctx, sessionFile } = loadCompactor();
    const original = ' {"type":"custom","data":"keep spacing"}\n\n';
    await writeFile(sessionFile, original);
    await pi.event("agent_start")({ type: "agent_start" }, ctx);
    await pi.event("agent_end")({ type: "agent_end", messages: [toolMessage("empty", "No matches found")] }, ctx);

    await pi.event("session_shutdown")({ type: "session_shutdown", reason: "reload" }, ctx);

    expect(await readFile(sessionFile, "utf8")).toBe(original);
  });
});
