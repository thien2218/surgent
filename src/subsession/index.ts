import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import type { Message } from "@earendil-works/pi-ai";
import type {
  SubsessionRequest,
  SubsessionResult,
  SubsessionMeta,
  SubsessionSnapshot,
  OnSnapshotCallback,
} from "./types.js";

export * from "./types.js";

export const IS_SUBSESSION = process.env["SURGENT_SUBSESSION"] === "true";
const STRIPPED_TOOLS = new Set(["bash", "subagent", "questionnaire", "permission"]);

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }
  const execName = currentScript?.split("/").pop()?.toLowerCase() ?? "";
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) {
    return { command: process.execPath, args };
  }
  return { command: "surgent", args };
}

function getFinalOutput(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role === "assistant") {
      for (const part of msg.content) {
        if (part.type === "text") return part.text;
      }
    }
  }
  return "";
}

export async function runSubsession(
  request: SubsessionRequest,
  signal?: AbortSignal,
  onSnapshot?: OnSnapshotCallback,
): Promise<SubsessionResult> {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const startedAt = Date.now();

  const snapshot: SubsessionSnapshot = {
    id,
    agent: request.agentMeta.name,
    status: "running",
    elapsedMs: 0,
    activity: "thinking",
    toolCounts: {},
  };

  const emitSnapshot = () => {
    snapshot.elapsedMs = Date.now() - startedAt;
    onSnapshot?.(snapshot);
  };

  const safeTools = request.tools.filter((tool) => !STRIPPED_TOOLS.has(tool));

  const args: string[] = [
    "--mode",
    "json",
    "-p",
    "--no-session",
    "--system-prompt",
    request.prompt,
  ];
  if (safeTools.length > 0) args.push("--tools", safeTools.join(","));
  if (request.model) args.push("--model", request.model.id);
  args.push(`Task: ${request.task}`);

  const messages: Message[] = [];
  const evidenceRefs: string[] = [];
  const toolCounts: Record<string, number> = {};
  const toolsUsed = new Set<string>();
  let tokenInput = 0;
  let tokenOutput = 0;
  let modelId = request.model?.id ?? "";
  let stopReason: string | undefined;
  let wasAborted = false;
  let stderr = "";

  const exitCode = await new Promise<number>((resolve) => {
    const invocation = getPiInvocation(args);
    const proc = spawn(invocation.command, invocation.args, {
      cwd: process.cwd(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        SURGENT_SUBSESSION: "true",
        SURGENT_SUBSESSION_FILES: JSON.stringify(request.files),
      },
    }) as ChildProcess;

    let buffer = "";

    const processLine = (line: string) => {
      if (!line.trim()) return;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return;
      }

      if (event["type"] === "tool_execution_start") {
        const toolName = event["toolName"] as string | undefined;
        if (toolName) {
          snapshot.activity = toolName;
          emitSnapshot();
        }
        return;
      }

      if (event["type"] === "message_end" && event["message"]) {
        const msg = event["message"] as Message;
        messages.push(msg);

        if (msg.role === "assistant") {
          const usage = msg.usage;
          if (usage) {
            tokenInput += usage.input || 0;
            tokenOutput += usage.output || 0;
          }
          if (!modelId && msg.model) modelId = msg.model;
          if (msg.stopReason) stopReason = msg.stopReason;

          for (const part of msg.content) {
            if (part.type === "toolCall") {
              const name = part.name;
              toolCounts[name] = (toolCounts[name] ?? 0) + 1;
              toolsUsed.add(name);
              snapshot.toolCounts = { ...toolCounts };

              const filePath = part.arguments?.["path"] as string | undefined;
              if (
                (name === "write" || name === "edit") &&
                filePath &&
                !evidenceRefs.includes(filePath)
              ) {
                evidenceRefs.push(filePath);
              }
            }
          }
        }

        snapshot.activity = "thinking";
        emitSnapshot();
      }
    };

    proc.stdout!.on("data", (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) processLine(line);
    });

    proc.stderr!.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code: number | null) => {
      if (buffer.trim()) processLine(buffer);
      resolve(code ?? 0);
    });

    proc.on("error", () => resolve(1));

    if (signal) {
      const killProc = () => {
        wasAborted = true;
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) proc.kill("SIGKILL");
        }, 5000);
      };
      if (signal.aborted) killProc();
      else signal.addEventListener("abort", killProc, { once: true });
    }
  });

  const durationMs = Date.now() - startedAt;
  const isError = exitCode !== 0 || stopReason === "error";
  const status: SubsessionResult["status"] = wasAborted ? "aborted" : isError ? "error" : "done";

  snapshot.status = status;
  emitSnapshot();

  const meta: SubsessionMeta = {
    id,
    parentSessionId: request.parentId,
    agent: request.agentMeta.name,
    modelId,
    tokenUsage: { input: tokenInput, output: tokenOutput },
    toolsUsed: Array.from(toolsUsed),
    durationMs,
  };

  const content = getFinalOutput(messages) || (isError ? stderr.trim() : "");
  return { status, content, evidenceRefs, meta };
}
