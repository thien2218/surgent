import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import {
  createErrorResult,
  createSubsessionBridge,
  formatToolUse,
  getLastAssistantOutput,
} from "./helpers.js";
import { resolveScoutEvidence } from "./evidence.js";
import { validateBuiltInOutput } from "./validation.js";
import {
  findSubsession,
  findSubsessionFile,
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

async function createSdkSession(
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
    extensionFactories: [
      createSubsessionBridge(request.ctx, runtime.meta, sessionManager.getSessionId()),
    ],
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd: request.ctx.cwd,
    model,
    thinkingLevel:
      runtime.meta.thinking_level ?? (request.id ? undefined : request.ctx.thinkingLevel),
    resourceLoader,
    sessionManager,
    tools: Array.isArray(runtime.meta.tools) ? runtime.meta.tools : [],
  });
  return session;
}

async function createSubsession(params: CreateSubsessionParams): Promise<Subsession> {
  const { cwd, onSnapshot, session, ...rest } = params;
  const subsession: Subsession = {
    ...rest,
    async exec(input: string, signal?: AbortSignal) {
      if (!session) {
        subsession.result = createErrorResult("Subsession unavailable");
        return;
      }

      let validationError: string | undefined;
      const request = { session, input, signal, onSnapshot, usage: subsession.result.usage };

      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (attempt === 1) {
          request.input = `Output failed validation: ${validationError}\nReturn only corrected output required by <output_contract>.`;
        }

        subsession.result = await executeTurn(request);
        if (!subsession.runtime.builtIn || subsession.result.status !== "done") {
          validationError = undefined;
          break;
        }

        validationError = validateBuiltInOutput(subsession.runtime.agent, subsession.result.output);
        if (subsession.runtime.agent === "scout") {
          const resolved = resolveScoutEvidence(session, subsession.result.output, cwd);
          validationError = resolved.error;

          if (!validationError) {
            subsession.result.output = resolved.output ?? "[]";
            subsession.result.evidence = resolved.evidence;
          }
        }

        if (!validationError) break;
      }

      if (validationError) {
        subsession.result.status = "error";
        subsession.result.output = `Output validation failed: ${validationError}`;
      }

      await saveSubsession(cwd, subsession);
    },
    async dispose() {
      session?.dispose();
    },
  };

  await saveSubsession(cwd, subsession);
  return subsession;
}

export async function openSubsession(request: SubsessionRequest): Promise<Subsession> {
  const pid = request.ctx.sessionManager.getSessionId();
  const existing =
    request.label !== "subagent" ? await findSubsession(request.ctx.cwd, request.id, pid) : null;
  const agentName = existing?.agent ?? request.agent;
  const runtime = await resolveRuntime(request.ctx.cwd, agentName);

  const params: CreateSubsessionParams = {
    cwd: request.ctx.cwd,
    label: request.label,
    pid,
    title: "Untitled",
    result: {
      status: "done",
      output: "",
      usage: { input: 0, output: 0, toolCalls: 0 },
      toolCounts: {},
    },
    runtime,
    onSnapshot: request.onSnapshot,
  };

  try {
    if (!existing && request.id) {
      throw Error(`Subsession not found: ${request.id}`);
    }
    params.session = await createSdkSession(request, runtime);
    if (existing && request.id) {
      params.title = existing.title;
      params.result.id = request.id;
      params.result.usage = existing.usage;
      params.result.output = await loadSubsessionOutput(request.ctx.cwd, request.id);
    }
  } catch (error) {
    params.result = createErrorResult(error instanceof Error ? error.message : String(error));
    if (params.session && !params.result.id) {
      params.result.id = params.session.sessionId;
    }
  }

  return createSubsession(params);
}
