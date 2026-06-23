import { spawn, type ChildProcess } from "node:child_process";
import { findSubsession, resolveRuntime, saveSubsession } from "./storage.js";
import { createJsonLineParser, getFinalOutput } from "./parser.js";
import {
  createErrorResult,
  extractSubsessionTitle,
  getSurgentInvoker,
  parseInteractionHandoff,
} from "./helpers.js";
import type {
  SubsessionLabel,
  SubsessionRequest,
  Subsession,
  RuntimeConfig,
  SubsessionResult,
  SubsessionSnapshot,
  SubsessionStatus,
} from "./types.js";
import { getPiPath } from "../utils.js";

interface ExecuteTurnRequest {
  sessionId?: string;
  input: string;
  runtime: RuntimeConfig;
  agent: string;
  signal?: AbortSignal;
  onSnapshot?: (snapshot: SubsessionSnapshot) => void;
}

interface CreateSubsessionParams {
  agent: string;
  pid: string;
  label: SubsessionLabel;
  title: string;
  result: SubsessionResult;
  runtime: RuntimeConfig;
  onSnapshot?: (snapshot: SubsessionSnapshot) => void;
}

async function executeTurn(request: ExecuteTurnRequest): Promise<SubsessionResult> {
  const args: string[] = ["--mode", "json", "-p", "--session-dir", getPiPath("subsessionsDir")];
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

  const snapshot: SubsessionSnapshot = {
    id: request.sessionId ?? "",
    status: "running",
    activity: "thinking",
    toolsUsed: [],
    usage: { input: 0, output: 0, toolCalls: 0 },
  };

  request.onSnapshot?.(snapshot);
  const parser = createJsonLineParser(snapshot, request.onSnapshot);

  let wasAborted = false;
  let stderrOutput = "";

  const exitCode = await new Promise<number>((resolve) => {
    const invoker = getSurgentInvoker(args);
    const childProcess = spawn(invoker.command, invoker.args, {
      cwd: process.cwd(),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, SURGENT_SUBSESSION: "true", SURGENT_SUBAGENT: request.agent },
    }) as ChildProcess;

    childProcess.stdin?.end(request.input);

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

  const interaction = parseInteractionHandoff(stderrOutput);
  const isError = exitCode !== 0 || parser.state.stopReason === "error";
  const output = getFinalOutput(parser.state.messages) || (isError ? stderrOutput.trim() : "");
  const status: SubsessionStatus = interaction
    ? "pending"
    : wasAborted || parser.state.stopReason === "aborted"
      ? "aborted"
      : isError
        ? "error"
        : "done";

  snapshot.status = status;
  request.onSnapshot?.(snapshot);

  return {
    id: snapshot.id || request.sessionId || "",
    status,
    output,
    usage: snapshot.usage,
    toolCounts: parser.state.toolCounts,
    interaction,
  };
}

function createSubsession(params: CreateSubsessionParams): Subsession {
  const { onSnapshot, agent, ...rest } = params;
  const subsession: Subsession = {
    ...rest,
    async exec(input: string, signal?: AbortSignal) {
      const nextTurn = await executeTurn({
        agent,
        sessionId: subsession.result.id,
        input,
        runtime: rest.runtime,
        signal,
        onSnapshot,
      });
      subsession.result = nextTurn;
    },
  };

  return subsession;
}

export default async function runInteractive(
  request: SubsessionRequest,
  onSnapshot?: (snapshot: SubsessionSnapshot) => void,
): Promise<Subsession> {
  const runtime = await resolveRuntime(request.agent, request.modelId);
  const params: Partial<CreateSubsessionParams> = {
    agent: request.agent,
    label: request.label,
    pid: request.pid,
    title: "",
    runtime,
    onSnapshot,
  };

  if (request.id) {
    const existing = await findSubsession(request.id, request.pid);
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
      const errorOutput = initialTurn.output.trim();
      params.result = createErrorResult(errorOutput || "Cannot start interactive subsession");
    } else {
      params.result = initialTurn;
      const extractedTitle = extractSubsessionTitle(initialTurn.output);
      if (extractedTitle) {
        params.title = extractedTitle;
      }

      await saveSubsession(initialTurn.id, {
        label: request.label,
        pid: request.pid,
        title: params.title,
        usage: initialTurn.usage,
      });
    }
  }

  return createSubsession(params as CreateSubsessionParams);
}
