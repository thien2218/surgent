import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createAgentSession,
  createEventBus,
  type AgentSession,
  type AgentSessionEvent,
  type ExtensionContext,
  type SessionManager,
} from "@earendil-works/pi-coding-agent";
import { onTestFinished, vi, type Mock } from "vitest";
import { createState } from "../../src/state.js";
import type { SubsessionRequest, SubsessionSnapshot } from "../../src/subagent/types.js";
import { agentWorkspace } from "./agent.js";
import { assistantMessage, commandContext } from "./commands.js";
import { recordExtension } from "./extension.js";

export type SessionTurn = (session: ReturnType<typeof sdkSession>) => void | Promise<void>;

export function sdkSession(manager: SessionManager, turns: SessionTurn[]): {
  sessionId: string;
  messages: AgentSession["messages"];
  bindExtensions: Mock<AgentSession["bindExtensions"]>;
  getAllTools: Mock<() => { name: string }[]>;
  setActiveToolsByName: Mock<AgentSession["setActiveToolsByName"]>;
  getContextUsage: Mock<AgentSession["getContextUsage"]>;
  subscribe: Mock<AgentSession["subscribe"]>;
  emit(event: AgentSessionEvent): void;
  listenerCount(): number;
  prompt: Mock<AgentSession["prompt"]>;
  abort: Mock<AgentSession["abort"]>;
  extensionRunner: { emit: Mock<(...args: unknown[]) => Promise<void>> };
  dispose: Mock<AgentSession["dispose"]>;
} {
  const listeners = new Set<Parameters<AgentSession["subscribe"]>[0]>();
  const session = {
    sessionId: manager.getSessionId(),
    messages: manager.buildSessionContext().messages,
    bindExtensions: vi.fn<AgentSession["bindExtensions"]>().mockResolvedValue(undefined),
    getAllTools: vi.fn(() => [{ name: "read" }, { name: "bash" }]),
    setActiveToolsByName: vi.fn<AgentSession["setActiveToolsByName"]>(),
    getContextUsage: vi.fn<AgentSession["getContextUsage"]>().mockReturnValue(undefined),
    subscribe: vi.fn<AgentSession["subscribe"]>((listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    }),
    emit(event: AgentSessionEvent) {
      if (event.type === "message_end") {
        session.messages.push(event.message);
        if (event.message.role !== "branchSummary" && event.message.role !== "compactionSummary") {
          manager.appendMessage(event.message);
        }
      }
      for (const listener of listeners) listener(event);
    },
    listenerCount: () => listeners.size,
    prompt: vi.fn<AgentSession["prompt"]>(async () => {
      const turn = turns.shift();
      if (turn) await turn(session);
      else session.emit({ type: "message_end", message: assistantMessage("Complete") });
    }),
    abort: vi.fn<AgentSession["abort"]>().mockResolvedValue(undefined),
    extensionRunner: { emit: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined) },
    dispose: vi.fn<AgentSession["dispose"]>(),
  };
  return session;
}

export async function subagentSetup() {
  const workspace = await agentWorkspace();
  await writeFile(join(workspace.local, "worker.md"), "---\ndescription: Test worker\n---\nWorker instructions\n");
  const extension = recordExtension({ events: createEventBus() });
  const state = createState(extension.api, {
    name: "assistant", body: "Parent instructions", meta: { description: "Parent" }, filePath: "",
  }, "assistant");
  onTestFinished(() => state.dispose());
  const context = commandContext(workspace.cwd);
  const modelRegistry = { find: vi.fn<ExtensionContext["modelRegistry"]["find"]>() };
  const ctx = { ...context.ctx, modelRegistry } as unknown as ExtensionContext;
  const snapshots: SubsessionSnapshot[] = [];
  const request: SubsessionRequest = {
    ctx, state, agent: "worker", temporary: true,
    onSnapshot: (snapshot) => { snapshots.push(structuredClone(snapshot)); },
  };
  const turns: SessionTurn[] = [];
  const sessions: ReturnType<typeof sdkSession>[] = [];
  vi.mocked(createAgentSession).mockImplementation(async (options) => {
    if (!options?.sessionManager) throw new Error("Missing SDK session manager");
    const session = sdkSession(options.sessionManager, turns);
    sessions.push(session);
    return { session: session as unknown as AgentSession } as Awaited<ReturnType<typeof createAgentSession>>;
  });
  return { ...workspace, extension, state, ctx, ui: context.ui, modelRegistry, request, snapshots, turns, sessions };
}
