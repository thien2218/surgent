#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { appendFile, cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { readUsageMetricsForRunnerSession } from './usage.mjs';

const benchmarkDirectoryPath = path.dirname(fileURLToPath(import.meta.url));
const defaultManifestPath = path.join(benchmarkDirectoryPath, 'tasks.json');
const defaultOutputPath = path.join(benchmarkDirectoryPath, 'results.csv');
const allowedRunnerNames = ['surgent', 'copilot'];
const allowedRunnerNameSet = new Set(allowedRunnerNames);
const csvHeaderColumns = ['agent', 'task', 'completionTime', 'testsPassedPercent', 'inputTokens', 'outputTokens', 'totalTokens', 'cacheHit', 'totalCost'];
const sessionsRootDirectoryPath = path.join(benchmarkDirectoryPath, 'sessions');
const setupPromptText = [
  'Environment restrictive.',
  'Execute instructions exactly in given order.',
  'Work only in current workspace.',
  'Use bash only for running tests when prompt explicitly asks for tests.',
  'Do not ask clarifying questions.',
  'Reply `Ready`. Wait for further instructions.'
].join(' ');
const helpText = `Usage: node benchmark/run.mjs --runner <surgent|copilot|both> --model <model> [options]

Options:
  --runner <name>   Runner to use: surgent, copilot, or both
  --model <name>    Logical model name for both CLIs
  --tasks <path>    Manifest path (default: ${defaultManifestPath})
  --output <path>   Output CSV path (default: ${defaultOutputPath})
  --task <id>       Task id filter. Repeat flag to run more than one task.
  --help            Show this help text
`;

function fail(message) {
  throw new Error(message);
}

async function loadManifest(manifestPath) {
  let manifestText;
  try {
    manifestText = await readFile(manifestPath, 'utf8');
  } catch (error) {
    fail(`Cannot read manifest at ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch (error) {
    fail(`Invalid JSON in manifest at ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail(`Manifest at ${manifestPath} must be JSON object.`);
  }

  return manifest;
}

async function ensureDirectoryPath(directoryPath, label) {
  let directoryStat;
  try {
    directoryStat = await stat(directoryPath);
  } catch (error) {
    fail(`${label} missing at ${directoryPath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!directoryStat.isDirectory()) {
    fail(`${label} must be directory: ${directoryPath}`);
  }
}

async function validateManifest(manifest, manifestPath) {
  const repositoryRootPath = path.resolve(path.dirname(manifestPath), '..');
  if (!Array.isArray(manifest.runnerOrder) || manifest.runnerOrder.length === 0) {
    fail(`Manifest at ${manifestPath} must include non-empty runnerOrder array.`);
  }

  const seenRunnerNames = new Set();
  for (const runnerName of manifest.runnerOrder) {
    if (typeof runnerName !== 'string' || !allowedRunnerNameSet.has(runnerName)) {
      fail(`Manifest runnerOrder has unsupported runner: ${String(runnerName)}`);
    }
    if (seenRunnerNames.has(runnerName)) {
      fail(`Manifest runnerOrder repeats runner: ${runnerName}`);
    }
    seenRunnerNames.add(runnerName);
  }

  if (manifest.csvRowOrder !== 'runnerOrder x tasks order') {
    fail(`Manifest at ${manifestPath} must set csvRowOrder to "runnerOrder x tasks order".`);
  }

  if (!Array.isArray(manifest.tasks) || manifest.tasks.length === 0) {
    fail(`Manifest at ${manifestPath} must include non-empty tasks array.`);
  }

  const seenTaskIds = new Set();
  for (const task of manifest.tasks) {
    if (!task || typeof task !== 'object' || Array.isArray(task)) {
      fail('Each manifest task must be object.');
    }

    if (typeof task.id !== 'string' || task.id.trim() === '') {
      fail('Each manifest task must include non-empty id string.');
    }
    if (seenTaskIds.has(task.id)) {
      fail(`Manifest repeats task id: ${task.id}`);
    }
    seenTaskIds.add(task.id);

    if (typeof task.workspaceDir !== 'string' || task.workspaceDir.trim() === '') {
      fail(`Task ${task.id} must include non-empty workspaceDir string.`);
    }
    if (typeof task.hiddenDir !== 'string' || task.hiddenDir.trim() === '') {
      fail(`Task ${task.id} must include non-empty hiddenDir string.`);
    }
    if (!Array.isArray(task.visibleTestCommand) || task.visibleTestCommand.length === 0 || task.visibleTestCommand.some((commandPart) => typeof commandPart !== 'string' || commandPart === '')) {
      fail(`Task ${task.id} must include non-empty visibleTestCommand string array.`);
    }
    if (!Array.isArray(task.hiddenTestCommand) || task.hiddenTestCommand.length === 0 || task.hiddenTestCommand.some((commandPart) => typeof commandPart !== 'string' || commandPart === '')) {
      fail(`Task ${task.id} must include non-empty hiddenTestCommand string array.`);
    }
    if (!Array.isArray(task.prompts) || task.prompts.length === 0 || task.prompts.some((promptText) => typeof promptText !== 'string' || promptText.trim() === '')) {
      fail(`Task ${task.id} must include non-empty prompts string array.`);
    }

    task.workspacePath = path.resolve(repositoryRootPath, task.workspaceDir);
    task.hiddenPath = path.resolve(repositoryRootPath, task.hiddenDir);

    await ensureDirectoryPath(task.workspacePath, `Task ${task.id} workspaceDir`);
    await ensureDirectoryPath(task.hiddenPath, `Task ${task.id} hiddenDir`);
  }
}

function resolveSelectedRunners(manifest, runnerSelection) {
  if (runnerSelection === 'both') {
    const selectedRunners = [];
    for (const runnerName of manifest.runnerOrder) {
      if (runnerName === 'surgent' || runnerName === 'copilot') {
        selectedRunners.push(runnerName);
      }
    }
    if (selectedRunners.length !== 2) {
      fail('Manifest runnerOrder must include surgent and copilot when --runner both is used.');
    }
    return selectedRunners;
  }

  if (!allowedRunnerNameSet.has(runnerSelection)) {
    fail(`Unsupported runner: ${runnerSelection}`);
  }
  if (!manifest.runnerOrder.includes(runnerSelection)) {
    fail(`Runner ${runnerSelection} missing from manifest runnerOrder.`);
  }

  return [runnerSelection];
}

function resolveSelectedTasks(manifest, selectedTaskIds) {
  if (!selectedTaskIds || selectedTaskIds.length === 0) {
    return manifest.tasks;
  }

  const selectedTaskIdSet = new Set(selectedTaskIds);
  const selectedTasks = manifest.tasks.filter((task) => selectedTaskIdSet.has(task.id));

  if (selectedTasks.length !== selectedTaskIdSet.size) {
    const knownTaskIdSet = new Set(manifest.tasks.map((task) => task.id));
    const missingTaskIds = [];
    for (const selectedTaskId of selectedTaskIdSet) {
      if (!knownTaskIdSet.has(selectedTaskId)) {
        missingTaskIds.push(selectedTaskId);
      }
    }
    fail(`Unknown task ids: ${missingTaskIds.join(', ')}`);
  }

  return selectedTasks;
}

function planRuns(selectedRunners, selectedTasks, modelName, outputPath) {
  const plannedRuns = [];
  for (const runnerName of selectedRunners) {
    for (const task of selectedTasks) {
      plannedRuns.push({
        runnerName,
        task,
        modelName,
        outputPath
      });
    }
  }
  return plannedRuns;
}

async function prepareWorkspaceCopy(task) {
  const runRootPath = await mkdtemp(path.join(os.tmpdir(), 'surgent-benchmark-run-'));
  const copiedWorkspacePath = path.join(runRootPath, 'workspace');

  await cp(task.workspacePath, copiedWorkspacePath, {
    recursive: true,
    errorOnExist: true,
    force: false
  });

  return {
    copiedWorkspacePath,
    runRootPath
  };
}

async function executeJsonCommand(commandName, commandArguments, commandWorkingDirectory, commandEnvironment) {
  return await new Promise((resolve, reject) => {
    const parsedEvents = [];
    const nonJsonStdoutLines = [];
    const stderrChunks = [];

    const commandProcess = spawn(commandName, commandArguments, {
      cwd: commandWorkingDirectory,
      env: commandEnvironment,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const stdoutReader = createInterface({ input: commandProcess.stdout });
    stdoutReader.on('line', (lineText) => {
      if (lineText.trim() === '') {
        return;
      }
      try {
        parsedEvents.push(JSON.parse(lineText));
      } catch {
        nonJsonStdoutLines.push(lineText);
      }
    });

    commandProcess.stderr.on('data', (stderrChunk) => {
      stderrChunks.push(stderrChunk.toString());
    });

    commandProcess.on('error', (commandError) => {
      reject(commandError);
    });

    commandProcess.on('close', (exitCode, signal) => {
      resolve({
        exitCode,
        signal,
        parsedEvents,
        nonJsonStdoutLines,
        stderrText: stderrChunks.join('')
      });
    });
  });
}

async function executeTextCommand(commandName, commandArguments, commandWorkingDirectory, commandEnvironment) {
  return await new Promise((resolve, reject) => {
    const stdoutChunks = [];
    const stderrChunks = [];

    const commandProcess = spawn(commandName, commandArguments, {
      cwd: commandWorkingDirectory,
      env: commandEnvironment,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    commandProcess.stdout.on('data', (stdoutChunk) => {
      stdoutChunks.push(stdoutChunk.toString());
    });

    commandProcess.stderr.on('data', (stderrChunk) => {
      stderrChunks.push(stderrChunk.toString());
    });

    commandProcess.on('error', (commandError) => {
      reject(commandError);
    });

    commandProcess.on('close', (exitCode, signal) => {
      resolve({
        exitCode,
        signal,
        stdoutText: stdoutChunks.join(''),
        stderrText: stderrChunks.join('')
      });
    });
  });
}

function parseSurgentSessionId(parsedEvents) {
  for (const eventObject of parsedEvents) {
    if (eventObject && eventObject.type === 'session' && typeof eventObject.id === 'string' && eventObject.id !== '') {
      return eventObject.id;
    }
    if (eventObject && eventObject.type === 'session.id' && typeof eventObject.data?.sessionId === 'string' && eventObject.data.sessionId !== '') {
      return eventObject.data.sessionId;
    }
  }
  fail('surgent JSON stream missing session id.');
}

function parseCopilotSessionId(parsedEvents) {
  for (let eventIndex = parsedEvents.length - 1; eventIndex >= 0; eventIndex -= 1) {
    const eventObject = parsedEvents[eventIndex];
    if (eventObject?.type === 'result' && typeof eventObject.sessionId === 'string' && eventObject.sessionId !== '') {
      return eventObject.sessionId;
    }
    if (eventObject?.type === 'session.id' && typeof eventObject.data?.sessionId === 'string' && eventObject.data.sessionId !== '') {
      return eventObject.data.sessionId;
    }
  }
  fail('copilot JSON stream missing session id.');
}

async function runSurgentSession(plannedRun, preparedWorkspace) {
  const promptSequence = [setupPromptText, ...plannedRun.task.prompts];
  const sessionDirectoryPath = preparedWorkspace.runRootPath;

  const sessionStartTimeMs = Date.now();
  let sessionId;

  for (const promptText of promptSequence) {
    const commandArguments = [
      '--mode',
      'json',
      '-p',
      promptText,
      '--model',
      `github-copilot/${plannedRun.modelName}`,
      '--session-dir',
      sessionDirectoryPath
    ];

    if (sessionId) {
      commandArguments.push('--session', sessionId);
    }

    const commandResult = await executeJsonCommand(
      'surgent',
      commandArguments,
      preparedWorkspace.copiedWorkspacePath,
      process.env
    );

    if (commandResult.exitCode !== 0) {
      fail(`surgent command failed with code ${String(commandResult.exitCode)}${commandResult.signal ? ` signal ${commandResult.signal}` : ''}: ${commandResult.stderrText || commandResult.nonJsonStdoutLines.join('\n')}`);
    }

    const parsedSessionId = parseSurgentSessionId(commandResult.parsedEvents);
    if (!sessionId) {
      sessionId = parsedSessionId;
    } else if (sessionId !== parsedSessionId) {
      fail(`surgent changed session id across prompts: ${sessionId} -> ${parsedSessionId}`);
    }

  }

  return {
    completionTimeMs: Date.now() - sessionStartTimeMs
  };
}

async function runCopilotSession(plannedRun, preparedWorkspace) {
  const promptSequence = [setupPromptText, ...plannedRun.task.prompts];
  const otelFilePath = path.join(preparedWorkspace.runRootPath, 'copilot-otel.jsonl');
  const sessionStartTimeMs = Date.now();
  let sessionId;

  for (const promptText of promptSequence) {
    await writeFile(otelFilePath, '', 'utf8');

    const commandArguments = [
      '-p',
      promptText,
      '--output-format',
      'json',
      '--no-ask-user',
      '--allow-all',
      '--stream',
      'off',
      '--model',
      plannedRun.modelName
    ];

    if (sessionId) {
      commandArguments.push('--session-id', sessionId);
    }

    const commandEnvironment = {
      ...process.env,
      COPILOT_OTEL_ENABLED: 'true',
      COPILOT_OTEL_EXPORTER_TYPE: 'file',
      COPILOT_OTEL_FILE_EXPORTER_PATH: otelFilePath
    };

    const commandResult = await executeJsonCommand(
      'copilot',
      commandArguments,
      preparedWorkspace.copiedWorkspacePath,
      commandEnvironment
    );

    if (commandResult.exitCode !== 0) {
      fail(`copilot command failed with code ${String(commandResult.exitCode)}${commandResult.signal ? ` signal ${commandResult.signal}` : ''}: ${commandResult.stderrText || commandResult.nonJsonStdoutLines.join('\n')}`);
    }

    const parsedSessionId = parseCopilotSessionId(commandResult.parsedEvents);
    if (!sessionId) {
      sessionId = parsedSessionId;
    } else if (sessionId !== parsedSessionId) {
      fail(`copilot changed session id across prompts: ${sessionId} -> ${parsedSessionId}`);
    }

  }

  return {
    completionTimeMs: Date.now() - sessionStartTimeMs
  };
}

function parseTestScorePayload(stdoutText, commandLabel) {
  const stdoutLines = stdoutText.split(/\r?\n/);

  for (let lineIndex = stdoutLines.length - 1; lineIndex >= 0; lineIndex -= 1) {
    const lineText = stdoutLines[lineIndex].trim();
    if (lineText === '') {
      continue;
    }

    let parsedScore;
    try {
      parsedScore = JSON.parse(lineText);
    } catch {
      continue;
    }

    if (!parsedScore || typeof parsedScore !== 'object' || Array.isArray(parsedScore)) {
      fail(`${commandLabel} score payload must be JSON object.`);
    }
    if (typeof parsedScore.passed !== 'number' || typeof parsedScore.total !== 'number') {
      fail(`${commandLabel} score payload must include numeric passed and total.`);
    }
    if (!Number.isFinite(parsedScore.passed) || !Number.isFinite(parsedScore.total)) {
      fail(`${commandLabel} score payload passed/total must be finite numbers.`);
    }
    if (parsedScore.passed < 0 || parsedScore.total < 0 || parsedScore.passed > parsedScore.total) {
      fail(`${commandLabel} score payload values are out of range.`);
    }

    return {
      passed: parsedScore.passed,
      total: parsedScore.total
    };
  }

  fail(`${commandLabel} missing JSON score payload in stdout.`);
}

async function runTestCommand(plannedRun, command, commandWorkingDirectory, commandEnvironment, commandLabel) {
  const commandResult = await executeTextCommand(
    command[0],
    command.slice(1),
    commandWorkingDirectory,
    commandEnvironment
  );

  if (commandResult.exitCode !== 0) {
    fail(`${plannedRun.task.id} ${commandLabel} test command failed with code ${String(commandResult.exitCode)}${commandResult.signal ? ` signal ${commandResult.signal}` : ''}: ${commandResult.stderrText || commandResult.stdoutText}`);
  }

  return parseTestScorePayload(commandResult.stdoutText, `${plannedRun.task.id} ${commandLabel}`);
}

async function runCombinedTestScore(plannedRun, preparedWorkspace) {
  const visibleScore = await runTestCommand(
    plannedRun,
    plannedRun.task.visibleTestCommand,
    preparedWorkspace.copiedWorkspacePath,
    process.env,
    'visible'
  );

  const hiddenScore = await runTestCommand(
    plannedRun,
    plannedRun.task.hiddenTestCommand,
    plannedRun.task.hiddenPath,
    {
      ...process.env,
      BENCHMARK_WORKSPACE: preparedWorkspace.copiedWorkspacePath
    },
    'hidden'
  );

  const passedTests = visibleScore.passed + hiddenScore.passed;
  const totalTests = visibleScore.total + hiddenScore.total;
  if (totalTests <= 0) {
    fail(`${plannedRun.task.id} total tests must be greater than zero.`);
  }

  return {
    testsPassedPercent: (passedTests / totalTests) * 100
  };
}

async function runPlannedRun(plannedRun, preparedWorkspace) {
  let sessionMetrics;

  if (plannedRun.runnerName === 'surgent') {
    sessionMetrics = await runSurgentSession(plannedRun, preparedWorkspace);
  } else if (plannedRun.runnerName === 'copilot') {
    sessionMetrics = await runCopilotSession(plannedRun, preparedWorkspace);
  } else {
    fail(`Unsupported runner for execution: ${plannedRun.runnerName}`);
  }

  const combinedTestScore = await runCombinedTestScore(plannedRun, preparedWorkspace);
  return {
    ...sessionMetrics,
    testsPassedPercent: combinedTestScore.testsPassedPercent
  };
}

async function persistRunSessionLogs(plannedRun, preparedWorkspace) {
  const taskSessionDirectoryPath = path.join(sessionsRootDirectoryPath, plannedRun.task.id);
  const runnerSessionDirectoryPath = path.join(taskSessionDirectoryPath, plannedRun.runnerName);
  const copiedWorkspaceAbsolutePath = path.resolve(preparedWorkspace.copiedWorkspacePath);

  await mkdir(taskSessionDirectoryPath, { recursive: true });
  await rm(runnerSessionDirectoryPath, { recursive: true, force: true });

  await cp(preparedWorkspace.runRootPath, runnerSessionDirectoryPath, {
    recursive: true,
    errorOnExist: false,
    force: true,
    filter: (sourcePath) => {
      const sourceAbsolutePath = path.resolve(sourcePath);
      return sourceAbsolutePath !== copiedWorkspaceAbsolutePath && !sourceAbsolutePath.startsWith(`${copiedWorkspaceAbsolutePath}${path.sep}`);
    }
  });
}

async function main() {
  const parsedArgs = parseArgs({
    options: {
      help: { type: 'boolean' },
      model: { type: 'string' },
      output: { type: 'string' },
      runner: { type: 'string' },
      task: { type: 'string', multiple: true },
      tasks: { type: 'string' }
    },
    strict: true,
    allowPositionals: false
  });

  if (parsedArgs.values.help) {
    process.stdout.write(helpText);
    return;
  }

  if (typeof parsedArgs.values.runner !== 'string' || parsedArgs.values.runner.trim() === '') {
    fail('Missing required --runner argument.');
  }
  if (typeof parsedArgs.values.model !== 'string' || parsedArgs.values.model.trim() === '') {
    fail('Missing required --model argument.');
  }

  const manifestPath = parsedArgs.values.tasks
    ? path.resolve(process.cwd(), parsedArgs.values.tasks)
    : defaultManifestPath;
  const outputPath = parsedArgs.values.output
    ? path.resolve(process.cwd(), parsedArgs.values.output)
    : defaultOutputPath;

  const manifest = await loadManifest(manifestPath);
  await validateManifest(manifest, manifestPath);
  await ensureDirectoryPath(path.dirname(outputPath), 'Output directory');

  const selectedRunners = resolveSelectedRunners(manifest, parsedArgs.values.runner);
  const selectedTasks = resolveSelectedTasks(manifest, parsedArgs.values.task);
  const plannedRuns = planRuns(selectedRunners, selectedTasks, parsedArgs.values.model, outputPath);

  if (plannedRuns.length === 0) {
    fail('No runs planned.');
  }

  process.stdout.write(`Planned ${plannedRuns.length} run(s) for model ${parsedArgs.values.model}.\n`);
  process.stdout.write(`Manifest: ${manifestPath}\n`);
  process.stdout.write(`Output: ${outputPath}\n`);

  for (const [runIndex, plannedRun] of plannedRuns.entries()) {
    process.stdout.write(`${runIndex + 1}. ${plannedRun.runnerName} -> ${plannedRun.task.id}\n`);
  }

  await writeFile(outputPath, `${csvHeaderColumns.join(',')}\n`, 'utf8');

  for (const plannedRun of plannedRuns) {
    const preparedWorkspace = await prepareWorkspaceCopy(plannedRun.task);
    let runMetrics;

    try {
      runMetrics = await runPlannedRun(plannedRun, preparedWorkspace);
    } finally {
      await persistRunSessionLogs(plannedRun, preparedWorkspace);
      await rm(preparedWorkspace.runRootPath, { recursive: true, force: true });
    }

    const sessionDirectoryPath = path.join(sessionsRootDirectoryPath, plannedRun.task.id, plannedRun.runnerName);
    const usageMetrics = await readUsageMetricsForRunnerSession(plannedRun.runnerName, sessionDirectoryPath);
    const formattedCompletionTime = (runMetrics.completionTimeMs / 1000).toFixed(1);
    const formattedCacheHit = usageMetrics.cacheHit.toFixed(3);
    const formattedTotalCost = usageMetrics.totalCostUsd === null ? null : usageMetrics.totalCostUsd.toFixed(3);

    process.stdout.write(`${plannedRun.runnerName} -> ${plannedRun.task.id}: completionTime=${formattedCompletionTime}, testsPassedPercent=${runMetrics.testsPassedPercent}, inputTokens=${usageMetrics.inputTokens}, outputTokens=${usageMetrics.outputTokens}, totalTokens=${usageMetrics.totalTokens}, cacheHit=${formattedCacheHit}, totalCost=${formattedTotalCost === null ? 'n/a' : formattedTotalCost}\n`);

    const csvRowValues = [
      plannedRun.runnerName,
      plannedRun.task.id,
      formattedCompletionTime,
      runMetrics.testsPassedPercent,
      usageMetrics.inputTokens,
      usageMetrics.outputTokens,
      usageMetrics.totalTokens,
      formattedCacheHit,
      formattedTotalCost === null ? '' : formattedTotalCost
    ];
    await appendFile(outputPath, `${csvRowValues.join(',')}\n`, 'utf8');
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
