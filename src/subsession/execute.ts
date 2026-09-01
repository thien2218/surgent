import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { createSubsessionBridge } from "./bridge.js";
import { createErrorResult, extractSubsessionTitle } from "./helpers.js";
import {
  findSubsession,
  findSubsessionSession,
  loadSubsessionOutput,
  resolveRuntime,
  saveSubsession,
} from "./storage.js";
import type {
  CreateSubsessionParams,
  ExecuteTurnRequest,
  RuntimeConfig,
  Subsession,
  SubsessionRequest,
  SubsessionResult,
  SubsessionSnapshot,
} from "./types.js";
import { getPiPath } from "../utils.js";

function formatToolUse(name: string, argumentsValue: unknown): string {
  if (!argumentsValue || typeof argumentsValue !== "object") {
    return `${name}()`;
  }
  try {
    return `${name}(${JSON.stringify(argumentsValue)})`;
  } catch {
    return `${name}(<args>)`;
  }
}

function getLastAssistantOutput(session: AgentSession): string {
  for (const message of [...session.messages].reverse()) {
    if (message.role !== "assistant") continue;
    for (const contentPart of [...message.content].reverse()) {
      if (contentPart.type === "text") {
        return contentPart.text;
      }
    }
  }
  return "";
}

async function executeTurn(request: ExecuteTurnRequest): Promise<SubsessionResult> {
  const snapshot: SubsessionSnapshot = {
    id: request.session.sessionId,
    status: "running",
    toolsUsed: [],
    usage: { ...request.usage },
  };
  const toolCounts: Record<string, number> = {};
  let aborted = false;
  let errorMessage = "";
  let lastMessage = "";
  let stoppedWithError = false;

  request.onSnapshot?.(snapshot);
  const unsubscribe = request.session.subscribe((event) => {
    if (event.type !== "message_end" || event.message.role !== "assistant") return;

    const message = event.message;
    snapshot.usage.input += message.usage?.input ?? 0;
    snapshot.usage.output += message.usage?.output ?? 0;
    if (message.stopReason === "aborted") {
      aborted = true;
    } else if (message.stopReason === "error") {
      stoppedWithError = true;
      errorMessage ||= message.errorMessage || "Subsession failed";
    }

    for (const contentPart of message.content) {
      if (contentPart.type === "text") {
        lastMessage = contentPart.text;
        continue;
      }
      if (contentPart.type !== "toolCall") continue;

      const toolCount = (toolCounts[contentPart.name] ?? 0) + 1;
      toolCounts[contentPart.name] = toolCount;
      snapshot.usage.toolCalls += 1;
      snapshot.toolsUsed.push(formatToolUse(contentPart.name, contentPart.arguments));
    }

    request.onSnapshot?.(snapshot);
  });

  const abortTurn = () => {
    aborted = true;
    void request.session.abort().catch(() => undefined);
  };

  try {
    if (request.signal?.aborted) {
      abortTurn();
    } else {
      request.signal?.addEventListener("abort", abortTurn, { once: true });
      await request.session.prompt(request.input);
    }
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  } finally {
    request.signal?.removeEventListener("abort", abortTurn);
    unsubscribe();
  }

  const output = lastMessage || getLastAssistantOutput(request.session);
  const errorOutput = errorMessage || output || "Subsession failed";
  const status = aborted ? "aborted" : stoppedWithError || errorMessage ? "error" : "done";

  snapshot.status = status;
  request.onSnapshot?.(snapshot);

  return {
    id: request.session.sessionId,
    status,
    output: status === "error" ? errorOutput : output,
    usage: snapshot.usage,
    toolCounts,
  };
}

async function openSessionManager(request: SubsessionRequest): Promise<SessionManager> {
  const subsessionsDir = getPiPath("subsessionsDir", request.ctx.cwd);
  if (!request.id) {
    const parentSession = request.ctx.sessionManager.getSessionFile();
    return SessionManager.create(request.ctx.cwd, subsessionsDir, { parentSession });
  }

  const storedSession = await findSubsessionSession(request.ctx.cwd, request.id);
  if (!storedSession) {
    throw new Error(`Subsession file not found: ${request.id}`);
  }
  return SessionManager.open(storedSession.path, storedSession.sessionDir, request.ctx.cwd);
}

async function createSdkSession(
  request: SubsessionRequest,
  runtime: RuntimeConfig,
  sessionManager: SessionManager,
): Promise<AgentSession> {
  const modelId = runtime.modelId;
  const requestedModel = request.id ? undefined : request.ctx.model;
  const model = modelId
    ? request.ctx.modelRegistry.getAll().find((available) => modelId.endsWith(available.id))
    : requestedModel;
  if (modelId && !model) {
    throw new Error(`Unknown model "${modelId}" in agent config`);
  }

  const resourceLoader = new DefaultResourceLoader({
    cwd: request.ctx.cwd,
    agentDir: getAgentDir(),
    noExtensions: true,
    systemPromptOverride: () => runtime.systemPrompt,
    extensionFactories: [
      createSubsessionBridge(request.ctx, runtime.agentMeta, sessionManager.getSessionId()),
    ],
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd: request.ctx.cwd,
    model,
    thinkingLevel: runtime.thinkingLevel ?? (request.id ? undefined : request.ctx.thinkingLevel),
    resourceLoader,
    sessionManager,
    tools: Array.isArray(runtime.tools) ? runtime.tools : [],
  });
  return session;
}

async function createSubsession(params: CreateSubsessionParams): Promise<Subsession> {
  const { agent, onSnapshot, session, ...rest } = params;

  const save = async (subsession: Subsession) => {
    if (!subsession.result.id) return;
    await saveSubsession(subsession.result.id, {
      label: subsession.label,
      pid: subsession.pid,
      title: subsession.title,
      usage: subsession.result.usage,
    });
  };

  const subsession: Subsession = {
    ...rest,
    async exec(input: string, signal?: AbortSignal) {
      if (!session) {
        subsession.result = createErrorResult("Subsession is unavailable");
        return;
      }

      subsession.result = await executeTurn({
        session,
        input,
        signal,
        onSnapshot,
        usage: subsession.result.usage,
      });
      await save(subsession);
    },
    async dispose() {
      session?.dispose();
    },
  };

  await save(subsession);
  return subsession;
}

export default async function runSubsession(
  request: SubsessionRequest,
  onSnapshot?: (snapshot: SubsessionSnapshot) => void,
): Promise<Subsession> {
  const runtime = await resolveRuntime(request.agent, request.modelId);
  const params: CreateSubsessionParams = {
    agent: request.agent,
    label: request.label,
    pid: request.pid,
    title: request.input.trim() || "Untitled",
    result: {
      status: "done",
      output: "",
      usage: { input: 0, output: 0, toolCalls: 0 },
      toolCounts: {},
    },
    runtime,
    onSnapshot,
  };

  try {
    const existing = await findSubsession(request.id, request.pid);
    if (!existing && request.id) {
      params.title = "Unknown subsession";
      throw Error(`Subsession not found: ${request.id}`);
    }

    const sessionManager = await openSessionManager(request);
    params.session = await createSdkSession(request, runtime, sessionManager);

    if (existing && request.id) {
      params.title = existing.title;
      params.result.id = request.id;
      params.result.usage = existing.usage;
      params.result.output = await loadSubsessionOutput(request.ctx.cwd, request.id);
    } else {
      params.result = await executeTurn({
        session: params.session,
        input: request.input,
        signal: request.signal,
        onSnapshot,
        usage: params.result.usage,
      });

      const title = extractSubsessionTitle(params.result.output);
      if (title) params.title = title;
    }
  } catch (error) {
    params.result = createErrorResult(error instanceof Error ? error.message : String(error));
    if (params.session && !params.result.id) {
      params.result.id = params.session.sessionId;
    }
  }

  return createSubsession(params);
}
