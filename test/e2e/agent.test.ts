import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ScriptStep } from "../fixtures/cli-provider.js";
import { cliPath, packageRoot, setupCli } from "../helpers/cli.js";

const providerPath = join(packageRoot, "test", "fixtures", "cli-provider.ts");
const model = { provider: "surgent-e2e", id: "scripted" };

async function startAgent(fixture: Awaited<ReturnType<typeof setupCli>>, script: ScriptStep[], args = ["--no-session"]) {
  await writeFile(join(fixture.workspace, "e2e-script.json"), JSON.stringify(script));
  return fixture.rpc([...args, "--extension", providerPath], fixture.workspace, cliPath, { model, allowGeneration: true });
}

function endedMessages(events: Record<string, unknown>[]) {
  return events.filter((record) => record.type === "message_end").map((record) => record.message);
}

describe("offline CLI agent journeys", () => {
  it("executes write/read calls and restores generated history across restart", async () => {
    const fixture = await setupCli();
    const sessionPath = join(fixture.root, "session.jsonl");
    await writeFile(sessionPath, "");
    const prompt = "Write notes.txt, then read it back.";
    const content = "Offline tool round trip\n";
    // Unicode separators belong inside one JSONL record, not between records.
    const finalText = "Saved\u2028and read\u2029offline";
    const session = await startAgent(fixture, [
      { type: "tool", expect: { prompt }, call: { type: "toolCall", id: "write-notes", name: "write", arguments: { path: "notes.txt", content } } },
      {
        type: "tool",
        expect: { result: { toolCallId: "write-notes", toolName: "write", isError: false } },
        call: { type: "toolCall", id: "read-notes", name: "read", arguments: { path: "notes.txt" } },
      },
      { type: "text", text: finalText, expect: { result: { toolCallId: "read-notes", toolName: "read", isError: false, includes: content.trim() } } },
    ], ["--session", sessionPath]);

    const turn = await session.promptAndWait(prompt);

    expect(await readFile(join(fixture.workspace, "notes.txt"), "utf8")).toBe(content);
    expect(endedMessages(turn)).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "toolResult", toolCallId: "write-notes", toolName: "write", isError: false }),
      expect.objectContaining({ role: "toolResult", toolCallId: "read-notes", toolName: "read", isError: false }),
      expect.objectContaining({ role: "assistant", stopReason: "stop", content: [{ type: "text", text: finalText }] }),
    ]));
    const saved = await session.request("get_state");
    await session.close();
    const entries = (await readFile(sessionPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(entries[0]).toMatchObject({ type: "session", id: saved.sessionId, cwd: fixture.workspace });
    expect(entries).toContainEqual(expect.objectContaining({
      type: "message", message: expect.objectContaining({ role: "assistant", content: [{ type: "text", text: finalText }] }),
    }));

    const reopened = await fixture.rpc(["--session", sessionPath, "--extension", providerPath], fixture.workspace, cliPath, { model });
    expect(reopened.state).toMatchObject({ sessionId: saved.sessionId, sessionFile: sessionPath });
    expect(await reopened.request("get_messages")).toMatchObject({ messages: expect.arrayContaining([
      expect.objectContaining({ role: "user", content: expect.arrayContaining([{ type: "text", text: prompt }]) }),
      expect.objectContaining({ role: "toolResult", toolCallId: "read-notes", isError: false }),
      expect.objectContaining({ role: "assistant", content: [{ type: "text", text: finalText }] }),
    ]) });
    expect(await reopened.request("get_last_assistant_text")).toEqual({ text: finalText });
    await reopened.close();
  }, 120_000);

  it("returns policy denial to the model without mutating the target", async () => {
    const fixture = await setupCli();
    await mkdir(join(fixture.home, ".pi", "agent"), { recursive: true });
    await writeFile(join(fixture.home, ".pi", "agent", "permissions.json"), JSON.stringify({ file: { "blocked.txt": "deny" } }));
    await writeFile(join(fixture.workspace, "blocked.txt"), "Keep this content\n");
    const session = await startAgent(fixture, [
      { type: "tool", call: { type: "toolCall", id: "blocked-write", name: "write", arguments: { path: "blocked.txt", content: "Unwanted change\n" } } },
      {
        type: "text", text: "Policy denial received",
        expect: { result: { toolCallId: "blocked-write", toolName: "write", isError: true, includes: "denied by policy rule" } },
      },
    ]);

    const turn = await session.promptAndWait("Try writing blocked.txt.");

    expect(await readFile(join(fixture.workspace, "blocked.txt"), "utf8")).toBe("Keep this content\n");
    expect(endedMessages(turn)).toContainEqual(expect.objectContaining({
      role: "toolResult", toolCallId: "blocked-write", isError: true,
      content: expect.arrayContaining([expect.objectContaining({ type: "text", text: expect.stringContaining("denied by policy rule") })]),
    }));
    expect(await session.request("get_last_assistant_text")).toEqual({ text: "Policy denial received" });
    await session.close();
  }, 120_000);

  it("fails closed when a tool needs permission UI unavailable in RPC", async () => {
    const fixture = await setupCli();
    const session = await startAgent(fixture, [
      {
        type: "tool",
        call: { type: "toolCall", id: "ask-bash", name: "bash", arguments: { command: "touch denied-marker", purpose: "Create a disposable permission-test marker" } },
      },
      {
        type: "text", text: "Permission cancellation received",
        expect: { result: { toolCallId: "ask-bash", toolName: "bash", isError: true, includes: "Permission request was cancelled" } },
      },
    ]);

    const turn = await session.promptAndWait("Run a command that needs permission.");

    await expect(readFile(join(fixture.workspace, "denied-marker"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(endedMessages(turn)).toContainEqual(expect.objectContaining({ role: "toolResult", toolCallId: "ask-bash", isError: true }));
    expect(await session.request("get_last_assistant_text")).toEqual({ text: "Permission cancellation received" });
    await session.close();
  }, 120_000);

  it("redacts read results before RPC output and the next model request", async () => {
    const fixture = await setupCli();
    const secret = `ghp_${"a".repeat(36)}`;
    await writeFile(join(fixture.workspace, "fake-secret.txt"), `Example token: ${secret}\n`);
    const session = await startAgent(fixture, [
      { type: "tool", call: { type: "toolCall", id: "read-secret", name: "read", arguments: { path: "fake-secret.txt" } } },
      {
        type: "text", text: "Only redacted content received",
        expect: { result: { toolCallId: "read-secret", toolName: "read", isError: false, includes: "(redacted texts)", excludes: secret } },
      },
    ]);

    const turn = await session.promptAndWait("Read fake-secret.txt.");

    expect(endedMessages(turn)).toContainEqual(expect.objectContaining({
      role: "toolResult", toolCallId: "read-secret", isError: false,
      content: expect.arrayContaining([expect.objectContaining({ type: "text", text: expect.stringContaining("(redacted texts)") })]),
    }));
    expect(JSON.stringify(turn)).not.toContain(secret);
    expect(JSON.stringify(await session.request("get_messages"))).not.toContain(secret);
    expect(await readFile(join(fixture.workspace, "fake-secret.txt"), "utf8")).toBe(`Example token: ${secret}\n`);
    expect(await session.request("get_last_assistant_text")).toEqual({ text: "Only redacted content received" });
    await session.close();
  }, 120_000);

  it("aborts active generation and accepts a new prompt in the same process", async () => {
    const fixture = await setupCli();
    const session = await startAgent(fixture, [
      { type: "hold", text: "Waiting for cancellation", expect: { prompt: "Start a held response." } },
      { type: "text", text: "Recovered after abort", expect: { prompt: "Respond normally now." } },
    ]);
    const after = session.events.length;
    await Promise.all([
      session.waitFor("message_update", after, (record) => {
        const update = record.assistantMessageEvent as { type?: string; delta?: string } | undefined;
        return update?.type === "text_delta" && update.delta === "Waiting for cancellation";
      }),
      session.request("prompt", { message: "Start a held response." }),
    ]);

    await Promise.all([session.waitFor("agent_settled", after), session.request("abort")]);

    expect(endedMessages(session.events.slice(after))).toContainEqual(expect.objectContaining({
      role: "assistant", stopReason: "aborted", errorMessage: expect.stringContaining("Scripted response aborted"),
    }));
    expect(await session.request("get_state")).toMatchObject({ isStreaming: false });
    await session.promptAndWait("Respond normally now.");
    expect(await session.request("get_last_assistant_text")).toEqual({ text: "Recovered after abort" });
    await session.close();
  }, 120_000);
});
