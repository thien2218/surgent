import { spawn, type ChildProcess } from "node:child_process";
import { findSubsession, loadSubsessionOutput, resolveRuntime, saveSubsession } from "./storage.js";
import { createJsonLineParser } from "./parser.js";
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
  SubsessionUsage,
} from "./types.js";
import { getPiPath } from "../utils.js";

interface ExecuteTurnRequest {
  sessionId?: string;
  input: string;
  runtime: RuntimeConfig;
  agent: string;
  signal?: AbortSignal;
  onSnapshot?: (snapshot: SubsessionSnapshot) => void;
  usage: SubsessionUsage;
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
  if (request.runtime.thinkingLevel) {
    args.push("--thinking", request.runtime.thinkingLevel);
  }

  const snapshot: SubsessionSnapshot = {
    id: request.sessionId ?? "",
    status: "running",
    toolsUsed: [],
    usage: request.usage,
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
  const output = parser.state.lastMessage || (isError ? stderrOutput.trim() : "");
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

async function createSubsession(params: CreateSubsessionParams): Promise<Subsession> {
  const { onSnapshot, agent, ...rest } = params;

  const save = async (subsession: Subsession) => {
    if (subsession.result.id) {
      await saveSubsession(subsession.result.id, {
        label: subsession.label,
        pid: subsession.pid,
        title: subsession.title,
        usage: subsession.result.usage,
      });
    }
  };

  const subsession: Subsession = {
    ...rest,
    async exec(input: string, signal?: AbortSignal) {
      subsession.result = await executeTurn({
        agent,
        sessionId: subsession.result.id,
        input,
        runtime: subsession.runtime,
        signal,
        onSnapshot,
        usage: subsession.result.usage,
      });

      await save(subsession);
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
    title: "",
    result: {
      status: "done",
      output: "",
      usage: { input: 0, output: 0, toolCalls: 0 },
      toolCounts: {},
    },
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
      params.result.id = request.id;
      params.result.usage = existing.usage;
      params.result.output = await loadSubsessionOutput(process.cwd(), request.id);
    }
  } else {
    params.title = request.input.trim() || "Untitled";

    const initialTurn = await executeTurn({
      agent: request.agent,
      input: request.input,
      runtime,
      signal: request.signal,
      onSnapshot,
      usage: { input: 0, output: 0, toolCalls: 0 },
    });

    if (!initialTurn.id) {
      const errorOutput = initialTurn.output.trim();
      params.result = createErrorResult(errorOutput || "Cannot start subsession");
    } else {
      params.result = initialTurn;
      const extractedTitle = extractSubsessionTitle(initialTurn.output);
      if (extractedTitle) {
        params.title = extractedTitle;
      }
    }
  }

  return createSubsession(params);
}
