import {
  BenchmarkAgent,
  type PromptTurn,
  type RunnerAdapter,
  type RunnerSessionState,
  type TaskDefinition,
  type NormalizedTurnTelemetry,
} from "../types.js";
import { runTurnCommand } from "./common.js";

const DEFAULT_SURGENT_COMMAND = "surgent";

const SURGENT_RUNNER: RunnerAdapter = {
  agent: BenchmarkAgent.Surgent,

  async openSession(
    taskDefinition: TaskDefinition,
    modelId: string | null,
    permissionEnvelope: string,
  ): Promise<RunnerSessionState> {
    return {
      agent: BenchmarkAgent.Surgent,
      taskId: taskDefinition.id,
      cwdPath: taskDefinition.repoDirPath,
      modelId,
      permissionEnvelope,
      externalSessionId: null,
      adapterState: null,
    };
  },

  async runTurn(
    sessionState: RunnerSessionState,
    promptTurn: PromptTurn,
    timeoutMs: number,
  ): Promise<NormalizedTurnTelemetry> {
    const surgentCommand = process.env.SURGENT_BIN?.trim() || DEFAULT_SURGENT_COMMAND;
    const commandArgs = ["--mode", "json", "-p"];

    if (sessionState.externalSessionId) {
      commandArgs.push("--session", sessionState.externalSessionId);
    }

    if (sessionState.modelId) {
      commandArgs.push("--model", sessionState.modelId);
    }

    commandArgs.push(promptTurn.prompt);

    const turnResult = await runTurnCommand(sessionState, promptTurn, {
      commandName: surgentCommand,
      commandArgs,
      cwdPath: sessionState.cwdPath,
      timeoutMs,
      stdinText: null,
      envVars: { BENCH_PERMISSION_ENVELOPE: sessionState.permissionEnvelope },
    });

    if (turnResult.discoveredSessionId) {
      sessionState.externalSessionId = turnResult.discoveredSessionId;
    }

    return turnResult.telemetry;
  },

  async closeSession(_sessionState: RunnerSessionState): Promise<void> {
    return;
  },
};

export default SURGENT_RUNNER;
