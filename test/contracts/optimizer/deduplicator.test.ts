import { SessionManager, type ContextEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import optimizer from "../../../src/optimizer/index.js";
import { assistantMessage } from "../../helpers/commands.js";
import { recordExtension } from "../../helpers/extension.js";
import { appendTool, startDeduplicator } from "../../helpers/optimizer.js";
import { createWorkspace } from "../../helpers/workspace.js";

async function session() {
  const workspace = await createWorkspace({ prefix: "surgent-dedup-contract-" });
  return SessionManager.inMemory(workspace.cwd);
}

function inspect(manager: SessionManager, id: string) {
  return appendTool(manager, id, "inspect", "source", { path: "file.ts", symbol: "handler" }, false, { path: "file.ts", symbol: "handler" });
}

function resultIds(messages: ContextEvent["messages"]) {
  return messages.filter((message) => message.role === "toolResult").map((message) => message.toolCallId);
}

describe("session-start request filtering", () => {
  it("registers transient filtering through the optimizer extension", () => {
    const pi = recordExtension();
    optimizer(pi.api);
    expect(pi.event("context")).toBeTypeOf("function");
  });

  it("freezes duplicates and writes across requests until another start", async () => {
    const manager = await session();
    inspect(manager, "old");
    inspect(manager, "new");
    const loaded = await startDeduplicator(manager);
    const branch = vi.spyOn(manager, "getBranch");
    const projection = vi.spyOn(manager, "buildSessionProjection");

    inspect(manager, "appended");
    appendTool(manager, "write", "write", "saved", { path: "file.ts", content: "changed" });
    inspect(manager, "fresh");
    const canonical = manager.buildSessionProjection().messages;
    const raw = structuredClone(manager.getEntries());
    projection.mockClear();
    for (let request = 0; request < 2; request++) {
      expect(resultIds(await loaded.request(canonical))).toEqual(["new", "appended", "write", "fresh"]);
    }
    expect(branch).not.toHaveBeenCalled();
    expect(projection).not.toHaveBeenCalled();
    expect(manager.getEntries()).toEqual(raw);
    expect(manager.getEntries().some((entry) => entry.type === "context_edit")).toBe(false);
    expect(manager.buildSessionProjection().messages).toEqual(canonical);

    await loaded.pi.event("session_start")({ type: "session_start", reason: "reload" }, loaded.ctx);
    expect(resultIds(await loaded.request())).toEqual(["write", "fresh"]);
  });

  it("filters incoming exchanges in pairs without losing other transformations or assistant metadata", async () => {
    const manager = await session();
    const assistant = assistantMessage("original explanation");
    assistant.content.unshift({ type: "thinking", thinking: "reasoning", thinkingSignature: "signature" });
    assistant.content.push(
      { type: "toolCall", id: "old", name: "inspect", arguments: { path: "file.ts", symbol: "handler" } },
      { type: "toolCall", id: "keep", name: "bash", arguments: { command: "pwd" } },
    );
    manager.appendMessage(assistant);
    manager.appendMessage({ role: "toolResult", toolCallId: "old", toolName: "inspect", content: [{ type: "text", text: "source" }], details: { path: "file.ts", symbol: "handler" }, isError: false, timestamp: 0 });
    manager.appendMessage({ role: "toolResult", toolCallId: "keep", toolName: "bash", content: [{ type: "text", text: "directory" }], isError: false, timestamp: 0 });
    inspect(manager, "new");
    const loaded = await startDeduplicator(manager);
    const messages = manager.buildSessionProjection().messages;
    messages[0] = { ...assistant, content: [assistant.content[0]!, { type: "text", text: "prior handler explanation" }, ...assistant.content.slice(2)] };
    messages.push({ role: "user", content: "request-only instruction", timestamp: 1 });
    const original = structuredClone(messages);

    const filtered = await loaded.request(messages);

    expect(filtered[0]).toEqual({ ...assistant, content: [assistant.content[0], { type: "text", text: "prior handler explanation" }, assistant.content[3]] });
    expect(resultIds(filtered)).toEqual(["keep", "new"]);
    expect(filtered.at(-1)).toEqual(messages.at(-1));
    expect(messages).toEqual(original);
    expect(manager.buildSessionProjection().messages[0]).toEqual(assistant);
  });

  it.each([false, true])("omits an affected assistant with no meaningful content (thinking=%s)", async (thinking) => {
    const manager = await session();
    const old = inspect(manager, "old");
    const entry = manager.getEntry(old.callId);
    if (entry?.type !== "message" || entry.message.role !== "assistant") throw new Error("Missing assistant");
    if (thinking) entry.message.content.unshift({ type: "thinking", thinking: "reasoning" });
    entry.message.content.push({ type: "text", text: "  " });
    inspect(manager, "new");
    const loaded = await startDeduplicator(manager);

    const filtered = await loaded.request();

    expect(filtered).toEqual(manager.buildSessionProjection().messages.slice(2));
    expect(manager.getEntry(old.callId)).toEqual(entry);
  });

  it.each(["session_tree", "session_shutdown"] as const)("clears the snapshot on %s", async (event) => {
    const manager = await session();
    inspect(manager, "old");
    inspect(manager, "new");
    const loaded = await startDeduplicator(manager);
    expect(resultIds(await loaded.request())).toEqual(["new"]);

    if (event === "session_tree") {
      await loaded.pi.event(event)({ type: event, oldLeafId: manager.getLeafId(), newLeafId: manager.getLeafId() }, loaded.ctx);
    } else {
      await loaded.pi.event(event)({ type: event, reason: "reload" }, loaded.ctx);
    }

    expect(await loaded.request()).toEqual(manager.buildSessionProjection().messages);
  });
});
