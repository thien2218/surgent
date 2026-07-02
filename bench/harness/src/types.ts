import { Type } from "typebox";
import Value from "typebox/value";

export enum BenchmarkAgent {
  Surgent = "surgent",
  Copilot = "copilot",
}

export enum TurnRunStatus {
  Ok = "ok",
  Error = "error",
  Timeout = "timeout",
}

export enum RunExecutionStatus {
  Ok = "ok",
  GradeFailed = "grade_failed",
  GradingFailed = "grading_failed",
  TurnFailed = "turn_failed",
  TurnException = "turn_exception",
  SessionOpenFailed = "session_open_failed",
  SessionCloseFailed = "session_close_failed",
}

export interface HarnessMetadataRecord {
  harnessVersion: string | null;
  gitCommitHash: string | null;
}

export interface FairnessControlsRecord {
  taskSeedHash: string;
  promptScriptHash: string;
  permissionEnvelope: string;
  agentExecutionOrderForRepeat: BenchmarkAgent[];
  infraRetryLimit: number;
}

export interface GradingScriptResultRecord {
  mode: "script" | "command";
  target: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  passed: boolean;
  errorMessage: string | null;
  stdout: string;
  stderr: string;
}

export interface GradingQualityCheckResultRecord {
  id: string;
  description: string;
  passed: boolean;
  skipped: boolean;
  command: string | null;
  script: string | null;
  notes: string[];
  result: GradingScriptResultRecord | null;
}

export interface GradingResult {
  pass_hidden: boolean;
  pass_visible: boolean;
  quality_checks_pass: boolean;
  grade_notes: string[];
  visible: GradingScriptResultRecord;
  hidden: GradingScriptResultRecord;
  quality_checks: GradingQualityCheckResultRecord[];
}

export interface SessionCostMetrics {
  pricingVersion: string;
  pricingModelId: string | null;
  inputCostUsd: number | null;
  outputCostUsd: number | null;
  cachedInputCostUsd: number | null;
  totalCostUsd: number | null;
  notes: string[];
}

export interface SessionMetrics {
  durationMsTotal: number;
  tokensInTotal: number | null;
  tokensOutTotal: number | null;
  tokensCachedTotal: number | null;
  contextUsedPctPeak: number | null;
  toolCallsTotal: number | null;
  sessionCost: SessionCostMetrics;
}

export interface BenchmarkRunRecord {
  runId: string;
  matrixPosition: number;
  matrixTotal: number;
  repeatNumber: number;
  taskId: string;
  agent: BenchmarkAgent;
  modelId: string | null;
  startedAt: string;
  finishedAt: string;
  turnTimeoutMs: number;
  maxTurns: number | null;
  permissionEnvelope: string;
  infraRetryAttempt: number;
  infraRetryTriggeredBy: RunExecutionStatus | null;
  harnessMetadata: HarnessMetadataRecord;
  fairnessControls: FairnessControlsRecord;
  turnsPlanned: number;
  turnsExecuted: number;
  status: RunExecutionStatus;
  errors: string[];
  sandboxRepoPath: string;
  artifactsPath: string;
  turns: NormalizedTurnTelemetry[];
  sessionMetrics: SessionMetrics;
  grading: GradingResult;
}

export interface PromptTurn {
  id: string;
  prompt: string;
}

export interface PromptScript {
  session_goal: string;
  turns: PromptTurn[];
}

export interface TaskDefinition {
  id: string;
  taskDirPath: string;
  repoDirPath: string;
  promptsFilePath: string;
  visibleTestsPath: string;
  hiddenTestsPath: string;
  rubricPath: string | null;
  promptScript: PromptScript;
}

export interface RunnerSessionState {
  agent: BenchmarkAgent;
  taskId: string;
  cwdPath: string;
  modelId: string | null;
  permissionEnvelope: string;
  externalSessionId: string | null;
  adapterState: unknown;
}

export interface NormalizedTurnTelemetry {
  taskId: string;
  agent: BenchmarkAgent;
  turnId: string;
  prompt: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: TurnRunStatus;
  exitCode: number;
  tokensIn: number | null;
  tokensOut: number | null;
  tokensCached: number | null;
  contextUsedPct: number | null;
  toolCalls: number | null;
  stopReason: string | null;
  rawStdout: string;
  rawStderr: string;
}

export interface RunnerAdapter {
  readonly agent: BenchmarkAgent;
  openSession(
    taskDefinition: TaskDefinition,
    modelId: string | null,
    permissionEnvelope: string,
  ): Promise<RunnerSessionState>;
  runTurn(sessionState: RunnerSessionState, promptTurn: PromptTurn, timeoutMs: number): Promise<NormalizedTurnTelemetry>;
  closeSession(sessionState: RunnerSessionState): Promise<void>;
}

const promptTurnSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    prompt: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const promptScriptSchema = Type.Object(
  {
    session_goal: Type.String({ minLength: 1 }),
    turns: Type.Array(promptTurnSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);

export function validatePromptScript(promptScript: unknown): PromptScript {
  if (Value.Check(promptScriptSchema, promptScript)) {
    return promptScript;
  }

  const validationErrors = Value.Errors(promptScriptSchema, promptScript);
  const firstError = validationErrors[0];

  if (!firstError) {
    throw new Error("Invalid prompts.yaml: unknown schema validation failure.");
  }

  const fieldPath = firstError.instancePath.replace(/^\//, "").replaceAll("/", ".").trim();
  if (fieldPath.length > 0) {
    throw new Error(`Invalid prompts.yaml field ${fieldPath}: ${firstError.message}`);
  }

  throw new Error(`Invalid prompts.yaml: ${firstError.message}`);
}

export function parseBenchmarkAgent(rawAgent: string): BenchmarkAgent {
  if (rawAgent === BenchmarkAgent.Surgent) {
    return BenchmarkAgent.Surgent;
  }

  if (rawAgent === BenchmarkAgent.Copilot) {
    return BenchmarkAgent.Copilot;
  }

  throw new Error(`Unsupported agent '${rawAgent}'. Expected 'surgent' or 'copilot'.`);
}
