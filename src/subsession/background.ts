import { spawn, type ChildProcess } from "node:child_process";
import { createJsonLineParser, getFinalOutput } from "./parser.js";
import { getPiInvocation, filterSubsessionTools } from "./herlpers.js";
import type { BackgroundRequest, SubsessionResult, SubsessionSnapshot } from "./types.js";
import { resolveRuntime } from "./storage.js";
import { union } from "../utils.js";

export default async function runBackground(
  request: BackgroundRequest,
  onSnapshot?: (snapshot: SubsessionSnapshot) => void,
): Promise<SubsessionResult> {
  const runtime = await resolveRuntime(request.agent);
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  const snapshot: SubsessionSnapshot = {
    id,
    status: "running",
    activity: "thinking",
    toolsUsed: [],
  };

  onSnapshot?.(snapshot);
  const safeTools = filterSubsessionTools(runtime.tools);

  const args: string[] = ["--mode", "json", "-p", "--no-session"];
  if (runtime.systemPrompt) {
    args.push("--system-prompt", runtime.systemPrompt);
  }
  if (safeTools.length > 0) {
    args.push("--tools", safeTools.join(","));
  }
  if (runtime.modelId) {
    args.push("--model", runtime.modelId);
  }
  args.push(`Task: ${request.task}`);

  const parser = createJsonLineParser(snapshot, onSnapshot);

  let wasAborted = false;
  let stderrOutput = "";

  const exitCode = await new Promise<number>((resolve) => {
    const invocation = getPiInvocation(args);
    const processHandle = spawn(invocation.command, invocation.args, {
      cwd: process.cwd(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        SURGENT_SUBSESSION: "true",
        SURGENT_SUBSESSION_FILES: JSON.stringify(union(request.files, runtime.files)),
      },
    }) as ChildProcess;

    processHandle.stdout?.on("data", (chunk: Buffer) => {
      parser.push(chunk.toString());
    });

    processHandle.stderr?.on("data", (chunk: Buffer) => {
      stderrOutput += chunk.toString();
    });

    processHandle.on("close", (code: number | null) => {
      parser.flush();
      resolve(code ?? 0);
    });

    processHandle.on("error", () => {
      parser.flush();
      resolve(1);
    });

    if (request.signal) {
      const terminateProcess = () => {
        wasAborted = true;
        processHandle.kill("SIGTERM");
        setTimeout(() => {
          if (!processHandle.killed) processHandle.kill("SIGKILL");
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
  onSnapshot?.(snapshot);

  return {
    status,
    output,
    usage: { input: parser.state.tokenInput, output: parser.state.tokenOutput },
    toolCounts: parser.state.toolCounts,
  };
}
