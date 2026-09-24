import { createErrorResult, formatToolUse, getLastAssistantOutput } from "./helpers.js";
import { validateBuiltInOutput } from "./validation.js";
import { findSubsession, loadSubsessionOutput, resolveRuntime, saveSubsession } from "./storage.js";
import type {
  CreateSubsessionParams,
  ExecuteTurnRequest,
  Subsession,
  SubsessionRequest,
  SubsessionResult,
  SubsessionSnapshot,
} from "./types.js";
import { createSdkSession } from "./sdk.js";

async function executeTurn(request: ExecuteTurnRequest): Promise<SubsessionResult> {
  const snapshot: SubsessionSnapshot = {
    id: request.session.sessionId,
    status: "running",
    toolsUsed: [],
    usage: request.usage,
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
    snapshot.usage.cost += message.usage?.cost.total ?? 0;
    snapshot.contextUsage = request.session.getContextUsage();

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

      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt === 1) {
          request.input = `Output failed validation: ${validationError}\nReturn only corrected output required by <output_contract>.`;
        }

        subsession.result = await executeTurn(request);
        if (!subsession.runtime.builtIn || subsession.result.status !== "done") {
          validationError = undefined;
          break;
        }

        validationError = validateBuiltInOutput(
          subsession.runtime.agent,
          subsession.result.output,
          input,
        );
        if (!validationError) break;
      }

      if (validationError) {
        subsession.result.status = "error";
        subsession.result.output = `Output validation failed: ${validationError}`;
      }

      await saveSubsession(cwd, subsession);
    },
    async dispose() {
      if (!session) return;
      try {
        await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      } finally {
        session.dispose();
      }
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
      usage: { input: 0, output: 0, toolCalls: 0, cost: 0 },
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
