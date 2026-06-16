import { spawn, type ChildProcess } from "node:child_process";
import { findSubsession, resolveRuntime, saveSubsession } from "./storage.js";
import { createJsonLineParser, getFinalOutput } from "./parser.js";
import { getPiInvocation } from "./herlpers.js";
import type {
  InteractiveLabel,
  InteractiveRequest,
  InteractiveSubsession,
  RuntimeConfig,
  SubsessionResult,
  SubsessionSnapshot,
} from "./types.js";

interface ExecuteTurnRequest {
  sessionId?: string;
  input: string;
  runtime: RuntimeConfig;
  agent: string;
  signal?: AbortSignal;
  onSnapshot?: (snapshot: SubsessionSnapshot) => void;
}

interface ExecuteTurnResult {
  id: string;
  result: SubsessionResult;
}

interface CreateSubsessionParams {
  id: string;
  agent: string;
  parentId: string;
  label: InteractiveLabel;
  title: string;
  result: SubsessionResult;
  runtime: RuntimeConfig;
  onSnapshot?: (snapshot: SubsessionSnapshot) => void;
}

function createErrorResult(message: string): SubsessionResult {
  return { status: "error", output: message, toolCounts: {} };
}

async function executeTurn(request: ExecuteTurnRequest): Promise<ExecuteTurnResult> {
  const args: string[] = ["--mode", "json", "-p"];
  const allowedTools = request.runtime.tools;

  if (request.sessionId) {
    args.push("--session", request.sessionId);
  }
  if (request.runtime.systemPrompt) {
    args.push("--system-prompt", request.runtime.systemPrompt);
  }
  if (Array.isArray(allowedTools) && allowedTools.length > 0) {
    args.push("--tools", allowedTools.join(","));
  } else {
    args.push("--no-tools");
  }
  if (request.runtime.modelId) {
    args.push("--model", request.runtime.modelId);
  }
  args.push(request.input);

  const snapshot: SubsessionSnapshot = {
    id: request.sessionId ?? "",
    status: "running",
    activity: "thinking",
    toolsUsed: [],
  };

  request.onSnapshot?.(snapshot);

  const parser = createJsonLineParser(snapshot, request.onSnapshot);
  let wasAborted = false;
  let stderrOutput = "";

  const exitCode = await new Promise<number>((resolve) => {
    const invocation = getPiInvocation(args);
    const childProcess = spawn(invocation.command, invocation.args, {
      cwd: process.cwd(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, SURGENT_SUBSESSION: "true", SURGENT_SUBAGENT: request.agent },
    }) as ChildProcess;

    childProcess.stdout?.on("data", (chunk: Buffer) => {
      parser.push(chunk.toString());
    });

    childProcess.stderr?.on("data", (chunk: Buffer) => {
      stderrOutput += chunk.toString();
    });

    childProcess.on("close", (code: number | null) => {
      parser.flush();
      resolve(code ?? 0);
    });

    childProcess.on("error", () => {
      parser.flush();
      resolve(1);
    });

    if (request.signal) {
      const terminateProcess = () => {
        wasAborted = true;
        childProcess.kill("SIGTERM");
        setTimeout(() => {
          if (!childProcess.killed) childProcess.kill("SIGKILL");
        }, 5000);
      };

      if (request.signal.aborted) {
        terminateProcess();
      } else {
        request.signal.addEventListener("abort", terminateProcess, { once: true });
      }
    }
  });

  const isError = exitCode !== 0 || parser.state.stopReason === "error";
  const status: SubsessionResult["status"] = wasAborted ? "aborted" : isError ? "error" : "done";
  const output = getFinalOutput(parser.state.messages) || (isError ? stderrOutput.trim() : "");

  snapshot.status = status;
  request.onSnapshot?.(snapshot);

  return {
    id: parser.state.sessionId || request.sessionId || "",
    result: {
      status,
      output,
      usage: { input: parser.state.tokenInput, output: parser.state.tokenOutput },
      toolCounts: parser.state.toolCounts,
    },
  };
}

function createSubsession(params: CreateSubsessionParams): InteractiveSubsession {
  const { onSnapshot, agent, ...rest } = params;
  const subsession: InteractiveSubsession = {
    ...rest,
    async exec(input: string, signal?: AbortSignal): Promise<void> {
      const nextTurn = await executeTurn({
        agent,
        sessionId: subsession.id,
        input,
        runtime: rest.runtime,
        signal,
        onSnapshot,
      });
      subsession.result = nextTurn.result;
    },
  };

  return subsession;
}

export default async function runInteractive(
  request: InteractiveRequest,
  onSnapshot?: (snapshot: SubsessionSnapshot) => void,
): Promise<InteractiveSubsession> {
  const runtime = await resolveRuntime(request.agent);
  const params: CreateSubsessionParams = {
    id: request.id ?? "",
    agent: request.agent,
    label: request.label,
    title: "",
    result: { status: "done", output: "", toolCounts: {} },
    parentId: request.parentId,
    runtime,
    onSnapshot,
  };

  if (request.id) {
    const existing = await findSubsession(request.parentId, request.id);
    if (!existing) {
      params.title = "Unknown subsession";
      params.result = createErrorResult(`Subsession not found: ${request.id}`);
    } else {
      params.label = existing.label;
      params.title = existing.title;
    }
  } else {
    params.title = request.input.trim() || "Untitled";

    const initialTurn = await executeTurn({
      agent: request.agent,
      input: request.input,
      runtime,
      signal: request.signal,
      onSnapshot,
    });

    if (!initialTurn.id) {
      params.result = createErrorResult("Cannot start interactive subsession");
    } else {
      params.id = initialTurn.id;
      params.result = initialTurn.result;

      await saveSubsession(request.parentId, initialTurn.id, {
        label: request.label,
        agent: request.agent,
        title: params.title,
      });
    }
  }

  return createSubsession(params);
}
