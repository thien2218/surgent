import { createAssistantMessageEventStream, type ToolCall } from "@earendil-works/pi-ai";
import {
  createAgentSessionFromServices, createAgentSessionServices, createCodemodeExtension, createMcpExtension,
  ModelRuntime, SessionManager, SettingsManager, type ExtensionFactory, type ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, onTestFinished } from "vitest";
import { Type } from "typebox";
import reducer from "../../src/optimizer/reducer/index.js";
import permission from "../../src/permission/index.js";
import { writeRules } from "../../src/permission/storage.js";
import redactor from "../../src/redactor/index.js";
import { createState } from "../../src/state.js";
import { assistantMessage } from "../helpers/commands.js";
import { createWorkspace } from "../helpers/workspace.js";

const fixturePath = fileURLToPath(new URL("../fixtures/codemode-mcp.mjs", import.meta.url));

it("routes real direct and codemode calls through permissions, redaction, and native accounting", async () => {
  const workspace = await createWorkspace({ prefix: "surgent-codemode-", changeCwd: true });
  const secret = `ghp_${"a".repeat(36)}`;
  const marker = "(redacted texts)";
  const calls: ToolCall[] = [
    { type: "toolCall", id: "direct", name: "mcp__fixture__safe", arguments: {} },
    { type: "toolCall", id: "parent", name: "codemode", arguments: { code: `
      const shell = await tools.bash({command: "printf '${secret}'; exit 7", purpose: "Test nested shell"});
      text({shell});
      const response = await tools.mcp__fixture__safe({});
      text({response});
      try { await tools.mcp__fixture__blocked({}); throw new Error("denial missing"); }
      catch (error) { text({denied: error.message.includes("denied by policy")}); }
      try { await tools.write({path: "secret.txt", content: "${secret}"}); throw new Error("write allowed"); }
      catch (error) { text({writeBlocked: error.message.includes("Secrets detected")}); }
      text(await tools.metered({}));
      text("ghp_" + "a".repeat(36));
    ` } },
  ];
  let cursor = 0;
  const provider: ExtensionFactory = (pi) => {
    pi.registerProvider("offline-results", {
      api: "offline-results", baseUrl: "https://offline.invalid", apiKey: "fake-test-key",
      models: [{ id: "scripted", name: "Offline results", reasoning: false, input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 4096 }],
      streamSimple(model) {
        const stream = createAssistantMessageEventStream();
        const message = assistantMessage("done");
        message.api = model.api;
        message.provider = model.provider;
        message.model = model.id;
        const call = calls[cursor++];
        if (call) {
          message.content = [call];
          message.stopReason = "toolUse";
        }
        stream.push({ type: "start", partial: message });
        stream.push({ type: "done", reason: call ? "toolUse" : "stop", message });
        stream.end();
        return stream;
      },
    });
  };
  const observed: ToolResultEvent[] = [];
  const errors: string[] = [];
  const settingsManager = SettingsManager.inMemory();
  settingsManager.applyOverrides({ defaultTools: ["read", "bash", "write", "edit", "codemode", "metered"], compaction: { enabled: false } });
  const agentDir = join(workspace.home, ".pi", "agent");
  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"), modelsPath: null, modelsStorePath: join(agentDir, "models"),
    allowModelNetwork: false, refreshOnCreate: false,
  });
  await writeRules({ project: {
    mcp: { "mcp__fixture__safe": true, "mcp__fixture__blocked": false },
    bash: { "*": true }, file: { "secret.txt": "write" },
  } }, workspace.cwd);
  const services = await createAgentSessionServices({
    cwd: workspace.cwd, agentDir, modelRuntime, settingsManager,
    resourceLoaderOptions: {
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      extensionFactories: [provider, createCodemodeExtension(), createMcpExtension(), (pi) => {
        pi.registerMcpServer("fixture", { command: process.execPath, args: [fixturePath], cwd: workspace.cwd, exposure: "direct" });
        const state = createState(pi, { name: "main", body: "", filePath: "main.md", meta: { description: "test" } }, "assistant");
        onTestFinished(() => state.dispose());
        pi.registerTool({
          name: "metered", label: "Metered", description: "Local usage fixture", parameters: Type.Object({}),
          outputSchema: Type.Object({ count: Type.Number() }),
          async execute() {
            return { content: [{ type: "text", text: "count" }], structuredContent: { count: 1 }, details: undefined,
              usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5,
                cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 } } };
          },
        });
        pi.on("tool_result", (event) => {
          if (event.toolName !== "bash") return;
          return { content: event.content, structuredContent: event.structuredContent,
            details: { ...event.details as object, composed: true } };
        });
      }, reducer, permission, redactor, (pi) => {
        pi.on("tool_result", (event) => { observed.push(structuredClone(event)); });
      }],
    },
  });
  const model = modelRuntime.getModel("offline-results", "scripted");
  expect(model).toBeDefined();
  const { session } = await createAgentSessionFromServices({
    services, model, thinkingLevel: "off", sessionManager: SessionManager.inMemory(workspace.cwd),
  });
  onTestFinished(async () => {
    try { await session.extensionRunner?.emit({ type: "session_shutdown", reason: "quit" }); }
    finally { session.dispose(); }
  });
  await session.bindExtensions({ onError: (error) => { errors.push(error.error); } });
  session.setActiveToolsByName([...session.getActiveToolNames(), "codemode"]);
  expect(session.getActiveToolNames()).not.toContain("powershell");
  await session.prompt("Run offline result checks");

  expect(errors).toEqual([]);
  expect(cursor).toBe(3);
  const parent = session.messages.find((message) => message.role === "toolResult" && message.toolCallId === "parent");
  if (parent?.role !== "toolResult") throw new Error("Missing parent result");
  expect(parent.content).toContainEqual(expect.objectContaining({ text: expect.stringContaining("Script completed") }));
  const direct = observed.find((event) => event.toolCallId === "direct");
  const nested = observed.find((event) => event.parentToolCallId === "parent" && event.toolName === "mcp__fixture__safe");
  expect(direct?.structuredContent).toEqual(nested?.structuredContent);
  expect(nested?.structuredContent).toMatchObject({ content: [{ type: "text", text: "fixture response" }], structuredContent: { count: 3 } });
  expect(nested?.toolCallId).toMatch(/^parent\/\d+$/);
  const shell = observed.find((event) => event.toolName === "bash");
  expect(shell).toMatchObject({ isError: true, parentToolCallId: "parent", details: { composed: true },
    structuredContent: { output: marker, exit_code: 7, truncated: false } });
  const output = parent.content.filter((item) => item.type === "text").map((item) => item.text).join("\n");
  expect(output).not.toContain(secret);
  expect(output).toContain(marker);
  expect(output).toContain('"denied":true');
  expect(output).toContain('"writeBlocked":true');
  expect(parent.isError).toBe(false);
  expect(parent.usage).toMatchObject({ input: 2, output: 3, totalTokens: 5, cost: { total: 3 } });
  expect(parent.nestedCalls?.calls).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: "mcp__fixture__blocked", status: "error" }),
    expect.objectContaining({ name: "write", status: "error" }),
  ]));
  expect(session.messages.filter((message) => message.role === "toolResult")).toHaveLength(2);
  await expect(access(join(workspace.cwd, "blocked-executed"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(access(join(workspace.cwd, "secret.txt"))).rejects.toMatchObject({ code: "ENOENT" });
}, 30000);
