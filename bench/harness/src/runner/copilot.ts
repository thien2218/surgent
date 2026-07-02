import { executeCommand } from "../util/exec.js";
import {
  BenchmarkAgent,
  type NormalizedTurnTelemetry,
  type PromptTurn,
  type RunnerAdapter,
  type RunnerSessionState,
  type TaskDefinition,
} from "../types.js";
import { runTurnCommand } from "./common.js";

interface CopilotAdapterState {
  commandName: string;
  baseArgs: string[];
  promptFlag: string | null;
  machineReadableArgs: string[];
  sessionFlag: string | null;
  supportsModelFlag: boolean;
  supportsContextUsageCommand: boolean;
  executedTurns: number;
}

const COPILOT_RUNNER: RunnerAdapter = {
  agent: BenchmarkAgent.Copilot,

  async openSession(
    taskDefinition: TaskDefinition,
    modelId: string | null,
    permissionEnvelope: string,
  ): Promise<RunnerSessionState> {
    const adapterState = await probeCopilotCapabilities(taskDefinition.repoDirPath);

    return {
      agent: BenchmarkAgent.Copilot,
      taskId: taskDefinition.id,
      cwdPath: taskDefinition.repoDirPath,
      modelId,
      permissionEnvelope,
      externalSessionId: null,
      adapterState,
    };
  },

  async runTurn(
    sessionState: RunnerSessionState,
    promptTurn: PromptTurn,
    timeoutMs: number,
  ): Promise<NormalizedTurnTelemetry> {
    const adapterState = toCopilotAdapterState(sessionState.adapterState);
    if (adapterState.executedTurns > 0 && !adapterState.sessionFlag) {
      throw new Error("Copilot CLI has no session resume flag. Persistent multi-turn run is not supported.");
    }

    const commandArgs = [...adapterState.baseArgs, ...adapterState.machineReadableArgs];

    if (adapterState.supportsModelFlag && sessionState.modelId) {
      commandArgs.push("--model", sessionState.modelId);
    }

    if (adapterState.sessionFlag && sessionState.externalSessionId) {
      commandArgs.push(adapterState.sessionFlag, sessionState.externalSessionId);
    }

    let stdinText: string | null = null;
    if (adapterState.promptFlag) {
      commandArgs.push(adapterState.promptFlag, promptTurn.prompt);
    } else {
      // naive stdin fallback - PTY if strict interactive shell needed
      stdinText = `${promptTurn.prompt}\n`;
    }

    const turnResult = await runTurnCommand(sessionState, promptTurn, {
      commandName: adapterState.commandName,
      commandArgs,
      cwdPath: sessionState.cwdPath,
      timeoutMs,
      stdinText,
      envVars: { BENCH_PERMISSION_ENVELOPE: sessionState.permissionEnvelope },
    });

    if (turnResult.discoveredSessionId) {
      sessionState.externalSessionId = turnResult.discoveredSessionId;
    }

    adapterState.executedTurns += 1;
    sessionState.adapterState = adapterState;

    return turnResult.telemetry;
  },

  async closeSession(_sessionState: RunnerSessionState): Promise<void> {
    return;
  },
};

async function probeCopilotCapabilities(cwdPath: string): Promise<CopilotAdapterState> {
  const candidateInvocations = buildCopilotCandidates();
  const probeErrors: string[] = [];

  for (const candidateInvocation of candidateInvocations) {
    const helpResult = await executeCommand({
      commandName: candidateInvocation.commandName,
      commandArgs: [...candidateInvocation.baseArgs, "--help"],
      cwdPath,
      timeoutMs: 15000,
      stdinText: null,
      envVars: null,
    });

    const helpText = `${helpResult.stdout}\n${helpResult.stderr}`;
    if (helpResult.exitCode !== 0 && helpText.trim().length === 0) {
      probeErrors.push(`${candidateInvocation.commandName} ${candidateInvocation.baseArgs.join(" ")}`.trim());
      continue;
    }

    const lowerHelpText = helpText.toLowerCase();
    let promptFlag: string | null = null;
    if (lowerHelpText.includes("--prompt")) {
      promptFlag = "--prompt";
    } else if (/\s-p[\s,]/.test(helpText)) {
      promptFlag = "-p";
    }

    let sessionFlag: string | null = null;
    if (lowerHelpText.includes("--session")) {
      sessionFlag = "--session";
    } else if (lowerHelpText.includes("--resume")) {
      sessionFlag = "--resume";
    }

    const machineReadableArgs: string[] = [];
    if (lowerHelpText.includes("--output-format") && lowerHelpText.includes("json")) {
      machineReadableArgs.push("--output-format", "json");
    } else if (lowerHelpText.includes("--output") && lowerHelpText.includes("json")) {
      machineReadableArgs.push("--output", "json");
    } else if (lowerHelpText.includes("--json")) {
      machineReadableArgs.push("--json");
    } else if (/--mode[^\n\r]*\bjson\b/.test(lowerHelpText)) {
      machineReadableArgs.push("--mode", "json");
    }

    return {
      commandName: candidateInvocation.commandName,
      baseArgs: candidateInvocation.baseArgs,
      promptFlag,
      machineReadableArgs,
      sessionFlag,
      supportsModelFlag: lowerHelpText.includes("--model"),
      supportsContextUsageCommand: lowerHelpText.includes("context"),
      executedTurns: 0,
    };
  }

  const probeErrorText = probeErrors.length === 0 ? "none" : probeErrors.join(", ");
  throw new Error(`Unable to detect copilot CLI capabilities. Checked: ${probeErrorText}`);
}

interface CandidateInvocation {
  commandName: string;
  baseArgs: string[];
}

function buildCopilotCandidates(): CandidateInvocation[] {
  const candidates: CandidateInvocation[] = [];

  const envCommand = process.env.COPILOT_BIN?.trim();
  if (envCommand && envCommand.length > 0) {
    const envCommandParts = envCommand.split(/\s+/).filter(Boolean);
    const commandName = envCommandParts[0];
    if (commandName) {
      candidates.push({
        commandName,
        baseArgs: envCommandParts.slice(1),
      });
    }
  }

  candidates.push({ commandName: "copilot", baseArgs: [] });
  candidates.push({ commandName: "gh", baseArgs: ["copilot"] });

  return candidates;
}

function toCopilotAdapterState(adapterState: unknown): CopilotAdapterState {
  if (typeof adapterState !== "object" || adapterState === null || Array.isArray(adapterState)) {
    throw new Error("Invalid copilot adapter state.");
  }

  const maybeState = adapterState as Record<string, unknown>;
  if (typeof maybeState["commandName"] !== "string") {
    throw new Error("Invalid copilot adapter state: commandName missing.");
  }

  if (!Array.isArray(maybeState["baseArgs"])) {
    throw new Error("Invalid copilot adapter state: baseArgs missing.");
  }

  if (!Array.isArray(maybeState["machineReadableArgs"])) {
    throw new Error("Invalid copilot adapter state: machineReadableArgs missing.");
  }

  const promptFlagValue = maybeState["promptFlag"];
  const sessionFlagValue = maybeState["sessionFlag"];

  if (promptFlagValue !== null && typeof promptFlagValue !== "string") {
    throw new Error("Invalid copilot adapter state: promptFlag invalid.");
  }

  if (sessionFlagValue !== null && typeof sessionFlagValue !== "string") {
    throw new Error("Invalid copilot adapter state: sessionFlag invalid.");
  }

  const executedTurnsValue = maybeState["executedTurns"];
  if (typeof executedTurnsValue !== "number" || !Number.isFinite(executedTurnsValue)) {
    throw new Error("Invalid copilot adapter state: executedTurns missing.");
  }

  return {
    commandName: maybeState["commandName"],
    baseArgs: (maybeState["baseArgs"] as unknown[]).filter((item): item is string => typeof item === "string"),
    promptFlag: promptFlagValue,
    machineReadableArgs: (maybeState["machineReadableArgs"] as unknown[]).filter(
      (item): item is string => typeof item === "string",
    ),
    sessionFlag: sessionFlagValue,
    supportsModelFlag: maybeState["supportsModelFlag"] === true,
    supportsContextUsageCommand: maybeState["supportsContextUsageCommand"] === true,
    executedTurns: executedTurnsValue,
  };
}

export default COPILOT_RUNNER;
