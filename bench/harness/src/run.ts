import { createHash, type Hash } from "node:crypto";
import { appendFile, cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDefaultTasksRootPath, loadTaskDefinition } from "./config.js";
import { gradeTaskRun } from "./grade/grader.js";
import { buildSessionMetrics } from "./metrics/parse.js";
import { writeSummaryReport } from "./report/summary.js";
import COPILOT_RUNNER from "./runner/copilot.js";
import { formatNullableMetric } from "./runner/common.js";
import SURGENT_RUNNER from "./runner/surgent.js";
import { executeCommand } from "./util/exec.js";
import {
  BenchmarkAgent,
  RunExecutionStatus,
  TurnRunStatus,
  parseBenchmarkAgent,
  type BenchmarkRunRecord,
  type FairnessControlsRecord,
  type GradingResult,
  type HarnessMetadataRecord,
  type NormalizedTurnTelemetry,
  type RunnerAdapter,
  type RunnerSessionState,
  type TaskDefinition,
} from "./types.js";

interface CliOptions {
  taskIds: string[];
  tasksRootPath: string;
  agents: BenchmarkAgent[];
  modelId: string | null;
  repeats: number;
  turnTimeoutMs: number;
  maxTurns: number | null;
  permissionEnvelope: string;
  runsDirPath: string;
  artifactsDirPath: string;
  outputJsonlPath: string;
}

interface TaskSeedSnapshot {
  seedRepoPath: string;
  taskSeedHash: string;
  promptScriptHash: string;
}

interface ExecuteRunRequest {
  runId: string;
  matrixPosition: number;
  matrixTotal: number;
  repeatNumber: number;
  taskDefinition: TaskDefinition;
  taskSeedSnapshot: TaskSeedSnapshot;
  runner: RunnerAdapter;
  modelId: string | null;
  turnTimeoutMs: number;
  maxTurns: number | null;
  permissionEnvelope: string;
  agentExecutionOrderForRepeat: BenchmarkAgent[];
  infraRetryLimit: number;
  infraRetryAttempt: number;
  infraRetryTriggeredBy: RunExecutionStatus | null;
  harnessMetadata: HarnessMetadataRecord;
  artifactsDirPath: string;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const defaultTasksRootPath = getDefaultTasksRootPath();
  const defaultRunsDirPath = path.resolve(fileURLToPath(new URL("../../runs", import.meta.url)));
  const defaultReportsDirPath = path.resolve(fileURLToPath(new URL("../../reports", import.meta.url)));

  const selectedTaskIds: string[] = [];
  const selectedAgentValues: string[] = [];

  let tasksRootPath = defaultTasksRootPath;
  let modelId: string | null = null;
  let repeats = 3;
  let turnTimeoutMs = 300000;
  let maxTurns: number | null = null;
  let permissionEnvelope = "default";
  let runsDirPath = defaultRunsDirPath;
  let artifactsDirPath = path.join(defaultRunsDirPath, "artifacts");
  let outputJsonlPath = "";
  let artifactsDirWasProvided = false;

  let currentArgIndex = 0;
  while (currentArgIndex < args.length) {
    const currentArg = args[currentArgIndex];

    if (currentArg === "--task") {
      const nextValue = args[currentArgIndex + 1];
      if (!nextValue) {
        throw new Error("Missing value for --task.");
      }
      selectedTaskIds.push(nextValue.trim());
      currentArgIndex += 2;
      continue;
    }

    if (currentArg === "--tasks") {
      const nextValue = args[currentArgIndex + 1];
      if (!nextValue) {
        throw new Error("Missing value for --tasks.");
      }

      for (const taskValue of parseCommaSeparatedValues(nextValue)) {
        selectedTaskIds.push(taskValue);
      }

      currentArgIndex += 2;
      continue;
    }

    if (currentArg === "--tasks-dir") {
      const nextValue = args[currentArgIndex + 1];
      if (!nextValue) {
        throw new Error("Missing value for --tasks-dir.");
      }
      tasksRootPath = path.resolve(nextValue);
      currentArgIndex += 2;
      continue;
    }

    if (currentArg === "--agent") {
      const nextValue = args[currentArgIndex + 1];
      if (!nextValue) {
        throw new Error("Missing value for --agent.");
      }
      selectedAgentValues.push(nextValue.trim());
      currentArgIndex += 2;
      continue;
    }

    if (currentArg === "--agents") {
      const nextValue = args[currentArgIndex + 1];
      if (!nextValue) {
        throw new Error("Missing value for --agents.");
      }

      for (const agentValue of parseCommaSeparatedValues(nextValue)) {
        selectedAgentValues.push(agentValue);
      }

      currentArgIndex += 2;
      continue;
    }

    if (currentArg === "--model") {
      const nextValue = args[currentArgIndex + 1];
      if (!nextValue) {
        throw new Error("Missing value for --model.");
      }
      modelId = nextValue;
      currentArgIndex += 2;
      continue;
    }

    if (currentArg === "--repeats") {
      const nextValue = args[currentArgIndex + 1];
      if (!nextValue) {
        throw new Error("Missing value for --repeats.");
      }

      const parsedRepeats = Number(nextValue);
      if (!Number.isInteger(parsedRepeats) || parsedRepeats <= 0) {
        throw new Error("--repeats must be positive integer.");
      }

      repeats = parsedRepeats;
      currentArgIndex += 2;
      continue;
    }

    if (currentArg === "--turn-timeout-ms" || currentArg === "--timeout-ms") {
      const nextValue = args[currentArgIndex + 1];
      if (!nextValue) {
        throw new Error(`Missing value for ${currentArg}.`);
      }

      const parsedTimeoutMs = Number(nextValue);
      if (!Number.isInteger(parsedTimeoutMs) || parsedTimeoutMs <= 0) {
        throw new Error(`${currentArg} must be positive integer.`);
      }

      turnTimeoutMs = parsedTimeoutMs;
      currentArgIndex += 2;
      continue;
    }

    if (currentArg === "--max-turns") {
      const nextValue = args[currentArgIndex + 1];
      if (!nextValue) {
        throw new Error("Missing value for --max-turns.");
      }

      const parsedMaxTurns = Number(nextValue);
      if (!Number.isInteger(parsedMaxTurns) || parsedMaxTurns <= 0) {
        throw new Error("--max-turns must be positive integer.");
      }

      maxTurns = parsedMaxTurns;
      currentArgIndex += 2;
      continue;
    }

    if (currentArg === "--permission-envelope") {
      const nextValue = args[currentArgIndex + 1];
      if (!nextValue) {
        throw new Error("Missing value for --permission-envelope.");
      }

      const parsedPermissionEnvelope = nextValue.trim();
      if (parsedPermissionEnvelope.length === 0) {
        throw new Error("--permission-envelope cannot be empty.");
      }

      permissionEnvelope = parsedPermissionEnvelope;
      currentArgIndex += 2;
      continue;
    }

    if (currentArg === "--runs-dir") {
      const nextValue = args[currentArgIndex + 1];
      if (!nextValue) {
        throw new Error("Missing value for --runs-dir.");
      }

      runsDirPath = path.resolve(nextValue);
      if (!artifactsDirWasProvided) {
        artifactsDirPath = path.join(runsDirPath, "artifacts");
      }

      currentArgIndex += 2;
      continue;
    }

    if (currentArg === "--artifacts-dir") {
      const nextValue = args[currentArgIndex + 1];
      if (!nextValue) {
        throw new Error("Missing value for --artifacts-dir.");
      }

      artifactsDirPath = path.resolve(nextValue);
      artifactsDirWasProvided = true;
      currentArgIndex += 2;
      continue;
    }

    if (currentArg === "--jsonl") {
      const nextValue = args[currentArgIndex + 1];
      if (!nextValue) {
        throw new Error("Missing value for --jsonl.");
      }

      outputJsonlPath = path.resolve(nextValue);
      currentArgIndex += 2;
      continue;
    }

    throw new Error(`Unknown argument: ${currentArg}`);
  }

  const selectedTaskIdSet = new Set(selectedTaskIds.filter((taskId) => taskId.length > 0));
  const taskIds = selectedTaskIdSet.size > 0 ? Array.from(selectedTaskIdSet) : await listTaskIds(tasksRootPath);
  if (taskIds.length === 0) {
    throw new Error(`No tasks found in tasks directory: ${tasksRootPath}`);
  }

  const agents: BenchmarkAgent[] = [];
  const selectedAgentSet =
    selectedAgentValues.length > 0
      ? new Set(selectedAgentValues.map((agentValue) => parseBenchmarkAgent(agentValue)))
      : new Set([BenchmarkAgent.Surgent, BenchmarkAgent.Copilot]);
  for (const agentValue of selectedAgentSet) {
    agents.push(agentValue);
  }

  const options: CliOptions = {
    taskIds,
    tasksRootPath,
    agents,
    modelId,
    repeats,
    turnTimeoutMs,
    maxTurns,
    permissionEnvelope,
    runsDirPath,
    artifactsDirPath,
    outputJsonlPath:
      outputJsonlPath.length > 0
        ? outputJsonlPath
        : path.join(
            runsDirPath,
            `runs-${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}.jsonl`,
          ),
  };

  await mkdir(options.runsDirPath, { recursive: true });
  await mkdir(options.artifactsDirPath, { recursive: true });
  await mkdir(path.dirname(options.outputJsonlPath), { recursive: true });

  const taskDefinitions: TaskDefinition[] = [];
  for (const taskId of options.taskIds) {
    taskDefinitions.push(await loadTaskDefinition(taskId, options.tasksRootPath));
  }

  const harnessMetadata = await resolveHarnessMetadata();
  const benchmarkSessionId = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const seedSnapshotsRootPath = path.join(options.artifactsDirPath, `_seed-snapshots-${benchmarkSessionId}`);
  await mkdir(seedSnapshotsRootPath, { recursive: true });

  const taskSeedSnapshotByTaskId = new Map<string, TaskSeedSnapshot>();
  for (const taskDefinition of taskDefinitions) {
    const taskSeedSnapshotPath = path.join(seedSnapshotsRootPath, taskDefinition.id);
    await cp(taskDefinition.repoDirPath, taskSeedSnapshotPath, { recursive: true });

    const promptScriptHash = createHash("sha256").update(JSON.stringify(taskDefinition.promptScript)).digest("hex");
    const taskSeedHash = await hashDirectoryContents(taskSeedSnapshotPath);

    taskSeedSnapshotByTaskId.set(taskDefinition.id, {
      seedRepoPath: taskSeedSnapshotPath,
      taskSeedHash,
      promptScriptHash,
    });
  }

  const infraRetryLimit = 1;
  const matrixTotal = options.repeats * taskDefinitions.length * options.agents.length;
  console.log(`Tasks: ${taskDefinitions.length} Agents: ${options.agents.length} Repeats: ${options.repeats}`);
  console.log(`Output JSONL: ${options.outputJsonlPath}`);
  console.log(`Harness version: ${harnessMetadata.harnessVersion ?? "unknown"}`);
  console.log(`Git commit: ${harnessMetadata.gitCommitHash ?? "unknown"}`);

  let matrixPosition = 0;
  for (let repeatNumber = 1; repeatNumber <= options.repeats; repeatNumber += 1) {
    const agentExecutionOrderForRepeat = [...options.agents];
    for (
      let shuffleCursor = agentExecutionOrderForRepeat.length - 1;
      shuffleCursor > 0;
      shuffleCursor -= 1
    ) {
      const swapTargetIndex = Math.floor(Math.random() * (shuffleCursor + 1));
      const currentAgent = agentExecutionOrderForRepeat[shuffleCursor];
      const swapTargetAgent = agentExecutionOrderForRepeat[swapTargetIndex];
      if (!currentAgent || !swapTargetAgent) {
        continue;
      }
      agentExecutionOrderForRepeat[shuffleCursor] = swapTargetAgent;
      agentExecutionOrderForRepeat[swapTargetIndex] = currentAgent;
    }

    console.log(`Repeat ${repeatNumber} agent-order=${agentExecutionOrderForRepeat.join(",")}`);

    for (const taskDefinition of taskDefinitions) {
      const taskSeedSnapshot = taskSeedSnapshotByTaskId.get(taskDefinition.id);
      if (!taskSeedSnapshot) {
        throw new Error(`Missing task seed snapshot for task '${taskDefinition.id}'.`);
      }

      for (const agent of agentExecutionOrderForRepeat) {
        matrixPosition += 1;
        const runIdBase = `${new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")}-${taskDefinition.id}-${agent}-repeat-${repeatNumber}`;

        let runRecord = await executeRun({
          runId: runIdBase,
          matrixPosition,
          matrixTotal,
          repeatNumber,
          taskDefinition,
          taskSeedSnapshot,
          runner: resolveRunner(agent),
          modelId: options.modelId,
          turnTimeoutMs: options.turnTimeoutMs,
          maxTurns: options.maxTurns,
          permissionEnvelope: options.permissionEnvelope,
          agentExecutionOrderForRepeat,
          infraRetryLimit,
          infraRetryAttempt: 0,
          infraRetryTriggeredBy: null,
          harnessMetadata,
          artifactsDirPath: options.artifactsDirPath,
        });

        if (
          infraRetryLimit > 0 &&
          (runRecord.status === RunExecutionStatus.SessionOpenFailed ||
            runRecord.status === RunExecutionStatus.SessionCloseFailed ||
            runRecord.status === RunExecutionStatus.TurnException ||
            runRecord.status === RunExecutionStatus.GradingFailed)
        ) {
          const initialInfraFailureStatus = runRecord.status;
          runRecord = await executeRun({
            runId: `${runIdBase}-infra-retry-1`,
            matrixPosition,
            matrixTotal,
            repeatNumber,
            taskDefinition,
            taskSeedSnapshot,
            runner: resolveRunner(agent),
            modelId: options.modelId,
            turnTimeoutMs: options.turnTimeoutMs,
            maxTurns: options.maxTurns,
            permissionEnvelope: options.permissionEnvelope,
            agentExecutionOrderForRepeat,
            infraRetryLimit,
            infraRetryAttempt: 1,
            infraRetryTriggeredBy: initialInfraFailureStatus,
            harnessMetadata,
            artifactsDirPath: options.artifactsDirPath,
          });
        }

        await appendFile(options.outputJsonlPath, `${JSON.stringify(runRecord)}\n`, "utf8");

        console.log(
          [
            `[${matrixPosition}/${matrixTotal}]`,
            `task=${taskDefinition.id}`,
            `agent=${agent}`,
            `repeat=${repeatNumber}`,
            `retry=${runRecord.infraRetryAttempt}`,
            `status=${runRecord.status}`,
            `turns=${runRecord.turnsExecuted}/${runRecord.turnsPlanned}`,
            `visible=${runRecord.grading.pass_visible}`,
            `hidden=${runRecord.grading.pass_hidden}`,
          ].join(" "),
        );
      }
    }
  }

  const summaryReport = await writeSummaryReport({
    inputJsonlPath: options.outputJsonlPath,
    reportsDirPath: defaultReportsDirPath,
  });

  console.log(`Summary CSV: ${summaryReport.summaryCsvPath}`);
  console.log(`Summary MD: ${summaryReport.summaryMarkdownPath}`);
  console.log("Matrix complete.");
}

async function executeRun(request: ExecuteRunRequest): Promise<BenchmarkRunRecord> {
  const runStartDate = new Date();
  const runArtifactsPath = path.join(request.artifactsDirPath, request.runId);
  const turnsArtifactDirPath = path.join(runArtifactsPath, "turns");
  const sandboxRepoPath = path.join(runArtifactsPath, "worktree");

  await mkdir(turnsArtifactDirPath, { recursive: true });
  await cp(request.taskSeedSnapshot.seedRepoPath, sandboxRepoPath, { recursive: true });

  const taskDefinitionForRun: TaskDefinition = {
    ...request.taskDefinition,
    repoDirPath: sandboxRepoPath,
  };

  const turnsToRun =
    request.maxTurns === null
      ? taskDefinitionForRun.promptScript.turns
      : taskDefinitionForRun.promptScript.turns.slice(0, request.maxTurns);

  const turnTelemetry: NormalizedTurnTelemetry[] = [];
  const errors: string[] = [];
  let status = RunExecutionStatus.Ok;
  let sessionState: RunnerSessionState | null = null;

  try {
    sessionState = await request.runner.openSession(taskDefinitionForRun, request.modelId, request.permissionEnvelope);

    for (const promptTurn of turnsToRun) {
      try {
        const currentTurnTelemetry = await request.runner.runTurn(sessionState, promptTurn, request.turnTimeoutMs);
        turnTelemetry.push(currentTurnTelemetry);

        const turnFilePrefix = path.join(turnsArtifactDirPath, promptTurn.id);
        await writeFile(`${turnFilePrefix}.stdout.log`, currentTurnTelemetry.rawStdout, "utf8");
        await writeFile(`${turnFilePrefix}.stderr.log`, currentTurnTelemetry.rawStderr, "utf8");
        await writeFile(`${turnFilePrefix}.telemetry.json`, `${JSON.stringify(currentTurnTelemetry, null, 2)}\n`, "utf8");

        console.log(
          [
            `  [${currentTurnTelemetry.turnId}]`,
            `status=${currentTurnTelemetry.status}`,
            `durationMs=${currentTurnTelemetry.durationMs}`,
            `tokensIn=${formatNullableMetric(currentTurnTelemetry.tokensIn)}`,
            `tokensOut=${formatNullableMetric(currentTurnTelemetry.tokensOut)}`,
            `tokensCached=${formatNullableMetric(currentTurnTelemetry.tokensCached)}`,
            `contextUsedPct=${formatNullableMetric(currentTurnTelemetry.contextUsedPct)}`,
            `toolCalls=${formatNullableMetric(currentTurnTelemetry.toolCalls)}`,
            `stopReason=${formatNullableMetric(currentTurnTelemetry.stopReason)}`,
          ].join(" "),
        );

        if (currentTurnTelemetry.status !== TurnRunStatus.Ok) {
          status = RunExecutionStatus.TurnFailed;
          errors.push(
            `Turn ${promptTurn.id} failed with status=${currentTurnTelemetry.status} exitCode=${currentTurnTelemetry.exitCode}.`,
          );
          break;
        }
      } catch (error) {
        status = RunExecutionStatus.TurnException;
        errors.push(`Turn ${promptTurn.id} crashed: ${formatErrorMessage(error)}`);
        break;
      }
    }
  } catch (error) {
    status = RunExecutionStatus.SessionOpenFailed;
    errors.push(`Session open failed: ${formatErrorMessage(error)}`);
  } finally {
    if (sessionState) {
      try {
        await request.runner.closeSession(sessionState);
      } catch (error) {
        if (status === RunExecutionStatus.Ok) {
          status = RunExecutionStatus.SessionCloseFailed;
        }
        errors.push(`Session close failed: ${formatErrorMessage(error)}`);
      }
    }
  }

  let grading: GradingResult;
  try {
    grading = await gradeTaskRun({
      taskDefinition: request.taskDefinition,
      sandboxRepoPath,
      timeoutMs: request.turnTimeoutMs,
      artifactsDirPath: runArtifactsPath,
    });
  } catch (error) {
    const gradingErrorMessage = formatErrorMessage(error);
    errors.push(`Grading failed: ${gradingErrorMessage}`);

    if (status === RunExecutionStatus.Ok) {
      status = RunExecutionStatus.GradingFailed;
    }

    grading = {
      pass_hidden: false,
      pass_visible: false,
      quality_checks_pass: false,
      grade_notes: [`Grading failed: ${gradingErrorMessage}`],
      visible: {
        mode: "script",
        target: request.taskDefinition.visibleTestsPath,
        exitCode: 1,
        timedOut: false,
        durationMs: 0,
        passed: false,
        errorMessage: gradingErrorMessage,
        stdout: "",
        stderr: "",
      },
      hidden: {
        mode: "script",
        target: request.taskDefinition.hiddenTestsPath,
        exitCode: 1,
        timedOut: false,
        durationMs: 0,
        passed: false,
        errorMessage: gradingErrorMessage,
        stdout: "",
        stderr: "",
      },
      quality_checks: [],
    };
  }

  if (status === RunExecutionStatus.Ok && (!grading.pass_hidden || !grading.pass_visible || !grading.quality_checks_pass)) {
    status = RunExecutionStatus.GradeFailed;
  }

  const sessionMetrics = buildSessionMetrics({
    modelId: request.modelId,
    turns: turnTelemetry,
  });

  const runFinishDate = new Date();

  const fairnessControls: FairnessControlsRecord = {
    taskSeedHash: request.taskSeedSnapshot.taskSeedHash,
    promptScriptHash: request.taskSeedSnapshot.promptScriptHash,
    permissionEnvelope: request.permissionEnvelope,
    agentExecutionOrderForRepeat: [...request.agentExecutionOrderForRepeat],
    infraRetryLimit: request.infraRetryLimit,
  };

  return {
    runId: request.runId,
    matrixPosition: request.matrixPosition,
    matrixTotal: request.matrixTotal,
    repeatNumber: request.repeatNumber,
    taskId: request.taskDefinition.id,
    agent: request.runner.agent,
    modelId: request.modelId,
    startedAt: runStartDate.toISOString(),
    finishedAt: runFinishDate.toISOString(),
    turnTimeoutMs: request.turnTimeoutMs,
    maxTurns: request.maxTurns,
    permissionEnvelope: request.permissionEnvelope,
    infraRetryAttempt: request.infraRetryAttempt,
    infraRetryTriggeredBy: request.infraRetryTriggeredBy,
    harnessMetadata: request.harnessMetadata,
    fairnessControls,
    turnsPlanned: turnsToRun.length,
    turnsExecuted: turnTelemetry.length,
    status,
    errors,
    sandboxRepoPath,
    artifactsPath: runArtifactsPath,
    turns: turnTelemetry,
    sessionMetrics,
    grading,
  };
}

async function resolveHarnessMetadata(): Promise<HarnessMetadataRecord> {
  const harnessPackageJsonPath = path.resolve(fileURLToPath(new URL("../package.json", import.meta.url)));
  const repositoryRootPath = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));

  let harnessVersion: string | null = null;
  try {
    const harnessPackageFileContent = await readFile(harnessPackageJsonPath, "utf8");
    const parsedPackageJson = JSON.parse(harnessPackageFileContent) as { version?: unknown };
    if (typeof parsedPackageJson.version === "string" && parsedPackageJson.version.trim().length > 0) {
      harnessVersion = parsedPackageJson.version.trim();
    }
  } catch {
    harnessVersion = null;
  }

  const gitCommitProbeResult = await executeCommand({
    commandName: "git",
    commandArgs: ["rev-parse", "HEAD"],
    cwdPath: repositoryRootPath,
    timeoutMs: 5000,
    stdinText: null,
    envVars: null,
  });

  let gitCommitHash: string | null = null;
  if (gitCommitProbeResult.exitCode === 0) {
    const parsedCommitHash = gitCommitProbeResult.stdout.trim();
    if (parsedCommitHash.length > 0) {
      gitCommitHash = parsedCommitHash;
    }
  }

  return {
    harnessVersion,
    gitCommitHash,
  };
}

async function hashDirectoryContents(rootPath: string): Promise<string> {
  const hashAccumulator = createHash("sha256");
  await updateHashFromDirectory(hashAccumulator, rootPath, rootPath);
  return hashAccumulator.digest("hex");
}

async function updateHashFromDirectory(hashAccumulator: Hash, rootPath: string, currentPath: string): Promise<void> {
  const directoryEntries = await readdir(currentPath, { withFileTypes: true });
  directoryEntries.sort((firstEntry, secondEntry) => firstEntry.name.localeCompare(secondEntry.name));

  for (const directoryEntry of directoryEntries) {
    const currentEntryPath = path.join(currentPath, directoryEntry.name);
    const relativeEntryPath = path.relative(rootPath, currentEntryPath).replaceAll(path.sep, "/");

    if (directoryEntry.isDirectory()) {
      hashAccumulator.update(`dir:${relativeEntryPath}\n`);
      await updateHashFromDirectory(hashAccumulator, rootPath, currentEntryPath);
      continue;
    }

    if (directoryEntry.isFile()) {
      hashAccumulator.update(`file:${relativeEntryPath}\n`);
      hashAccumulator.update(await readFile(currentEntryPath));
      continue;
    }

    hashAccumulator.update(`other:${relativeEntryPath}\n`);
  }
}

async function listTaskIds(tasksRootPath: string): Promise<string[]> {
  const taskIds: string[] = [];
  const directoryEntries = await readdir(tasksRootPath, { withFileTypes: true });

  for (const directoryEntry of directoryEntries) {
    if (!directoryEntry.isDirectory()) {
      continue;
    }

    const normalizedTaskId = directoryEntry.name.trim();
    if (normalizedTaskId.length === 0) {
      continue;
    }

    taskIds.push(normalizedTaskId);
  }

  taskIds.sort((firstTaskId, secondTaskId) => firstTaskId.localeCompare(secondTaskId));
  return taskIds;
}

function parseCommaSeparatedValues(rawValue: string): string[] {
  const parsedValues: string[] = [];

  for (const rawPart of rawValue.split(",")) {
    const trimmedPart = rawPart.trim();
    if (trimmedPart.length > 0) {
      parsedValues.push(trimmedPart);
    }
  }

  if (parsedValues.length === 0) {
    throw new Error(`Expected comma-separated values, got '${rawValue}'.`);
  }

  return parsedValues;
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function resolveRunner(agent: BenchmarkAgent): RunnerAdapter {
  if (agent === BenchmarkAgent.Surgent) {
    return SURGENT_RUNNER;
  }

  if (agent === BenchmarkAgent.Copilot) {
    return COPILOT_RUNNER;
  }

  throw new Error(`Unsupported agent: ${agent}`);
}

function printHelp() {
  console.log("Usage: node bench/harness/dist/run.js [options]");
  console.log("");
  console.log("Options:");
  console.log("  --task <task-id>            Include single task id (repeatable)");
  console.log("  --tasks <ids>               Include comma-separated task ids");
  console.log("  --tasks-dir <path>          Override tasks root directory");
  console.log("  --agent <surgent|copilot>   Include single agent (repeatable)");
  console.log("  --agents <ids>              Include comma-separated agents");
  console.log("  --model <model-id>          Optional model id override");
  console.log("  --repeats <number>          Repeat count per task-agent pair (default: 3)");
  console.log("  --turn-timeout-ms <number>  Per-turn timeout in milliseconds (default: 300000)");
  console.log("  --max-turns <number>        Limit turns per task session");
  console.log("  --permission-envelope <id>  Fairness label for permission scope (default: default)");
  console.log("  --runs-dir <path>           Run records output directory (default: bench/runs)");
  console.log("  --artifacts-dir <path>      Transcript/worktree output directory");
  console.log("  --jsonl <path>              Write run matrix JSONL to this path");
  console.log("  -h, --help                  Show this help message");
  console.log("");
  console.log("Defaults: all tasks under tasks-dir, both agents, 3 repeats.");
}

main().catch((error) => {
  const errorMessage = formatErrorMessage(error);
  console.error(`Benchmark run failed: ${errorMessage}`);
  process.exitCode = 1;
});
