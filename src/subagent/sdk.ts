import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  type AgentSession,
  type InlineExtension,
} from "@earendil-works/pi-coding-agent";
import type { RuntimeConfig, SubsessionRequest } from "./types.js";
import checkpoint from "../checkpoint/index.js";
import optimizer from "../optimizer/index.js";
import permission from "../permission/index.js";
import questionnaire from "../questionnaire/index.js";
import redactor from "../redactor/index.js";
import webTools from "../web-tools/index.js";
import { getPiPath } from "../utils.js";
import { findSubsessionFile } from "./storage.js";
import { STATE_EVENT, type AppState } from "../state.js";
import type { AgentMode } from "../agent/types.js";

const PATH_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);

function createSubsessionBridge(runtime: RuntimeConfig, state: AppState): InlineExtension[] {
  return [
    {
      name: "subsession-bridge",
      factory(pi) {
        const unsubscribe = pi.events.on(STATE_EVENT, (reply) => {
          if (typeof reply !== "function") return;
          reply({
            getAgent: () => ({
              name: runtime.agent,
              meta: runtime.meta,
              body: runtime.systemPrompt,
              filePath: "", // Runtime profiles do not have a source file.
            }),
            getMode: () => state.getMode(),
            setMode: (mode: AgentMode) => state.setMode(mode),
            dispose: () => unsubscribe(),
          } satisfies AppState);
        });
        pi.on("session_shutdown", () => unsubscribe());

        pi.on("tool_call", async (event) => {
          const path = (event.input as { path?: unknown }).path;
          if (PATH_TOOLS.has(event.toolName) && typeof path !== "string") {
            return { block: true, reason: "Explicit path required in subsession" };
          }
        });
      },
    },
    { name: "checkpoint", factory: checkpoint },
    { name: "optimizer", factory: optimizer },
    { name: "permission", factory: permission },
    { name: "questionnaire", factory: questionnaire },
    { name: "redactor", factory: redactor },
    { name: "web-tools", factory: webTools },
  ];
}

async function openSessionManager(request: SubsessionRequest): Promise<SessionManager> {
  if (request.label === "subagent") {
    return SessionManager.inMemory(request.ctx.cwd);
  }

  const subsessionsDir = getPiPath("subsessionsDir", request.ctx.cwd);
  if (!request.id) {
    const parentSession = request.ctx.sessionManager.getSessionFile();
    return SessionManager.create(request.ctx.cwd, subsessionsDir, { parentSession });
  }

  const subsessionFile = await findSubsessionFile(request.ctx.cwd, request.id);
  if (!subsessionFile) {
    throw new Error(`Subsession file not found: ${request.id}`);
  }

  return SessionManager.open(subsessionFile.path, subsessionFile.dir, request.ctx.cwd);
}

export async function createSdkSession(
  request: SubsessionRequest,
  runtime: RuntimeConfig,
): Promise<AgentSession> {
  const sessionManager = await openSessionManager(request);
  const modelId = runtime.meta.model;
  const model = modelId
    ? request.ctx.modelRegistry.find(
        modelId.slice(0, modelId.indexOf("/")),
        modelId.slice(modelId.indexOf("/") + 1),
      )
    : request.ctx.model;
  if (modelId && !model) {
    throw new Error(`Unknown model "${modelId}" in agent config`);
  }

  const resourceLoader = new DefaultResourceLoader({
    cwd: request.ctx.cwd,
    agentDir: getAgentDir(),
    noExtensions: true,
    systemPromptOverride: () => runtime.systemPrompt,
    extensionFactories: createSubsessionBridge(runtime, request.state),
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd: request.ctx.cwd,
    model,
    thinkingLevel:
      runtime.meta.thinking_level ?? (request.id ? undefined : request.ctx.thinkingLevel),
    resourceLoader,
    sessionManager,
  });

  try {
    await session.bindExtensions({
      mode: request.ctx.mode,
      uiContext: request.ctx.hasUI ? request.ctx.ui : undefined,
    });
  } catch (error) {
    session.dispose();
    throw error;
  }

  const availableTools = session.getAllTools().map((tool) => tool.name);
  const activeTools = runtime.meta.tools ?? availableTools;
  session.setActiveToolsByName(activeTools);
  return session;
}
