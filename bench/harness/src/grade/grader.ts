import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  GradingQualityCheckResultRecord,
  GradingResult,
  GradingScriptResultRecord,
  TaskDefinition,
} from "../types.js";
import { executeCommand, type CommandExecutionResult } from "../util/exec.js";

interface RubricQualityCheck {
  id: string;
  description: string;
  command: string | null;
  script: string | null;
}

export interface GradeTaskRequest {
  taskDefinition: TaskDefinition;
  sandboxRepoPath: string;
  timeoutMs: number;
  artifactsDirPath: string;
}

export async function gradeTaskRun(request: GradeTaskRequest): Promise<GradingResult> {
  const gradeNotes: string[] = [];

  const visibleResult = await runScriptGradeStep({
    scriptPath: request.taskDefinition.visibleTestsPath,
    sandboxRepoPath: request.sandboxRepoPath,
    timeoutMs: request.timeoutMs,
    artifactsDirPath: request.artifactsDirPath,
    artifactPrefix: "visible-tests",
  });

  const hiddenResult = await runScriptGradeStep({
    scriptPath: request.taskDefinition.hiddenTestsPath,
    sandboxRepoPath: request.sandboxRepoPath,
    timeoutMs: request.timeoutMs,
    artifactsDirPath: request.artifactsDirPath,
    artifactPrefix: "hidden-tests",
  });

  const qualityCheckResults: GradingQualityCheckResultRecord[] = [];
  let qualityChecksPass = true;

  if (request.taskDefinition.rubricPath === null) {
    gradeNotes.push("rubric.yaml missing, skipped quality checks.");
  } else {
    const rubricFileContent = await readFile(request.taskDefinition.rubricPath, "utf8");
    const rubricQualityChecks = parseRubricYaml(rubricFileContent);

    if (rubricQualityChecks.length === 0) {
      gradeNotes.push("rubric.yaml has no quality checks.");
    }

    for (let qualityCheckIndex = 0; qualityCheckIndex < rubricQualityChecks.length; qualityCheckIndex += 1) {
      const qualityCheck = rubricQualityChecks[qualityCheckIndex];
      if (!qualityCheck) {
        continue;
      }

      const qualityCheckArtifactPrefix = `quality-check-${String(qualityCheckIndex + 1).padStart(2, "0")}-${sanitizeArtifactSegment(qualityCheck.id)}`;
      const qualityCheckNotes: string[] = [];

      if (qualityCheck.command === null && qualityCheck.script === null) {
        qualityCheckNotes.push("No command or script configured, skipped.");
        qualityCheckResults.push({
          id: qualityCheck.id,
          description: qualityCheck.description,
          passed: true,
          skipped: true,
          command: null,
          script: null,
          notes: qualityCheckNotes,
          result: null,
        });
        continue;
      }

      if (qualityCheck.command !== null && qualityCheck.script !== null) {
        qualityCheckNotes.push("Both command and script configured. Keep one.");
        qualityCheckResults.push({
          id: qualityCheck.id,
          description: qualityCheck.description,
          passed: false,
          skipped: false,
          command: qualityCheck.command,
          script: qualityCheck.script,
          notes: qualityCheckNotes,
          result: null,
        });
        qualityChecksPass = false;
        continue;
      }

      if (qualityCheck.script !== null) {
        const resolvedScriptPath = path.isAbsolute(qualityCheck.script)
          ? qualityCheck.script
          : path.resolve(request.sandboxRepoPath, qualityCheck.script);

        const qualityCheckScriptResult = await runScriptGradeStep({
          scriptPath: resolvedScriptPath,
          sandboxRepoPath: request.sandboxRepoPath,
          timeoutMs: request.timeoutMs,
          artifactsDirPath: request.artifactsDirPath,
          artifactPrefix: qualityCheckArtifactPrefix,
        });

        qualityCheckResults.push({
          id: qualityCheck.id,
          description: qualityCheck.description,
          passed: qualityCheckScriptResult.passed,
          skipped: false,
          command: null,
          script: qualityCheck.script,
          notes: qualityCheckNotes,
          result: qualityCheckScriptResult,
        });

        if (!qualityCheckScriptResult.passed) {
          qualityChecksPass = false;
        }

        continue;
      }

      const qualityCheckCommand = qualityCheck.command;
      if (qualityCheckCommand === null) {
        qualityCheckNotes.push("Unknown quality-check config.");
        qualityCheckResults.push({
          id: qualityCheck.id,
          description: qualityCheck.description,
          passed: false,
          skipped: false,
          command: null,
          script: null,
          notes: qualityCheckNotes,
          result: null,
        });
        qualityChecksPass = false;
        continue;
      }

      const qualityCheckCommandResult = await runCommandGradeStep({
        command: qualityCheckCommand,
        sandboxRepoPath: request.sandboxRepoPath,
        timeoutMs: request.timeoutMs,
        artifactsDirPath: request.artifactsDirPath,
        artifactPrefix: qualityCheckArtifactPrefix,
      });

      qualityCheckResults.push({
        id: qualityCheck.id,
        description: qualityCheck.description,
        passed: qualityCheckCommandResult.passed,
        skipped: false,
        command: qualityCheckCommand,
        script: null,
        notes: qualityCheckNotes,
        result: qualityCheckCommandResult,
      });

      if (!qualityCheckCommandResult.passed) {
        qualityChecksPass = false;
      }
    }
  }

  if (!visibleResult.passed) {
    gradeNotes.push("visible-tests.sh failed.");
  }

  if (!hiddenResult.passed) {
    gradeNotes.push("hidden-tests.sh failed.");
  }

  if (!qualityChecksPass && qualityCheckResults.length > 0) {
    gradeNotes.push("One or more quality checks failed.");
  }

  return {
    pass_hidden: hiddenResult.passed,
    pass_visible: visibleResult.passed,
    quality_checks_pass: qualityChecksPass,
    grade_notes: gradeNotes,
    visible: visibleResult,
    hidden: hiddenResult,
    quality_checks: qualityCheckResults,
  };
}

interface ScriptGradeStepRequest {
  scriptPath: string;
  sandboxRepoPath: string;
  timeoutMs: number;
  artifactsDirPath: string;
  artifactPrefix: string;
}

interface CommandGradeStepRequest {
  command: string;
  sandboxRepoPath: string;
  timeoutMs: number;
  artifactsDirPath: string;
  artifactPrefix: string;
}

async function runScriptGradeStep(request: ScriptGradeStepRequest): Promise<GradingScriptResultRecord> {
  const scriptExecutionResult = await executeCommand({
    commandName: "bash",
    commandArgs: [request.scriptPath],
    cwdPath: request.sandboxRepoPath,
    timeoutMs: request.timeoutMs,
    stdinText: null,
    envVars: null,
  });

  await writeGradeArtifacts(request.artifactsDirPath, request.artifactPrefix, scriptExecutionResult);

  return toScriptResultRecord("script", request.scriptPath, scriptExecutionResult);
}

async function runCommandGradeStep(request: CommandGradeStepRequest): Promise<GradingScriptResultRecord> {
  const commandExecutionResult = await executeCommand({
    commandName: "bash",
    commandArgs: ["-lc", request.command],
    cwdPath: request.sandboxRepoPath,
    timeoutMs: request.timeoutMs,
    stdinText: null,
    envVars: null,
  });

  await writeGradeArtifacts(request.artifactsDirPath, request.artifactPrefix, commandExecutionResult);

  return toScriptResultRecord("command", request.command, commandExecutionResult);
}

async function writeGradeArtifacts(
  artifactsDirPath: string,
  artifactPrefix: string,
  executionResult: CommandExecutionResult,
): Promise<void> {
  await writeFile(path.join(artifactsDirPath, `${artifactPrefix}.stdout.log`), executionResult.stdout, "utf8");
  await writeFile(path.join(artifactsDirPath, `${artifactPrefix}.stderr.log`), executionResult.stderr, "utf8");
  await writeFile(
    path.join(artifactsDirPath, `${artifactPrefix}.result.json`),
    `${JSON.stringify(executionResult, null, 2)}\n`,
    "utf8",
  );
}

function toScriptResultRecord(
  mode: "script" | "command",
  target: string,
  executionResult: CommandExecutionResult,
): GradingScriptResultRecord {
  return {
    mode,
    target,
    exitCode: executionResult.exitCode,
    timedOut: executionResult.timedOut,
    durationMs: executionResult.durationMs,
    passed: executionResult.exitCode === 0 && !executionResult.timedOut,
    errorMessage: executionResult.errorMessage,
    stdout: executionResult.stdout,
    stderr: executionResult.stderr,
  };
}

function parseRubricYaml(fileContent: string): RubricQualityCheck[] {
  const fileLines = fileContent.split(/\r?\n/);
  let currentLineIndex = 0;
  let foundQualityChecksSection = false;
  const parsedQualityChecks: RubricQualityCheck[] = [];

  while (currentLineIndex < fileLines.length) {
    const rawLine = fileLines[currentLineIndex] ?? "";
    const trimmedLine = rawLine.trim();

    if (trimmedLine.length === 0 || trimmedLine.startsWith("#")) {
      currentLineIndex += 1;
      continue;
    }

    if (!foundQualityChecksSection) {
      if (trimmedLine !== "quality_checks:") {
        throw new Error(`Invalid rubric.yaml at line ${currentLineIndex + 1}: expected quality_checks: section.`);
      }

      foundQualityChecksSection = true;
      currentLineIndex += 1;
      continue;
    }

    if (!trimmedLine.startsWith("- id:")) {
      throw new Error(`Invalid rubric.yaml at line ${currentLineIndex + 1}: expected '- id: ...'.`);
    }

    const parsedCheckId = parseYamlScalar(trimmedLine.slice("- id:".length));
    if (parsedCheckId.length === 0) {
      throw new Error(`Invalid rubric.yaml at line ${currentLineIndex + 1}: quality check id cannot be empty.`);
    }

    const parsedQualityCheck: RubricQualityCheck = {
      id: parsedCheckId,
      description: "",
      command: null,
      script: null,
    };

    currentLineIndex += 1;

    while (currentLineIndex < fileLines.length) {
      const nextRawLine = fileLines[currentLineIndex] ?? "";
      const nextTrimmedLine = nextRawLine.trim();

      if (nextTrimmedLine.length === 0 || nextTrimmedLine.startsWith("#")) {
        currentLineIndex += 1;
        continue;
      }

      if (nextTrimmedLine.startsWith("- id:")) {
        break;
      }

      if (nextTrimmedLine.startsWith("description:")) {
        parsedQualityCheck.description = parseYamlScalar(nextTrimmedLine.slice("description:".length));
        currentLineIndex += 1;
        continue;
      }

      if (nextTrimmedLine.startsWith("command:")) {
        const parsedCommandValue = parseYamlScalar(nextTrimmedLine.slice("command:".length));
        parsedQualityCheck.command = parsedCommandValue.length > 0 ? parsedCommandValue : null;
        currentLineIndex += 1;
        continue;
      }

      if (nextTrimmedLine.startsWith("script:")) {
        const parsedScriptValue = parseYamlScalar(nextTrimmedLine.slice("script:".length));
        parsedQualityCheck.script = parsedScriptValue.length > 0 ? parsedScriptValue : null;
        currentLineIndex += 1;
        continue;
      }

      throw new Error(`Invalid rubric.yaml at line ${currentLineIndex + 1}: unsupported field.`);
    }

    if (parsedQualityCheck.description.length === 0) {
      parsedQualityCheck.description = parsedQualityCheck.id;
    }

    parsedQualityChecks.push(parsedQualityCheck);
  }

  if (!foundQualityChecksSection) {
    throw new Error("Invalid rubric.yaml: missing quality_checks section.");
  }

  const qualityCheckIdSet = new Set<string>();
  for (const parsedQualityCheck of parsedQualityChecks) {
    if (qualityCheckIdSet.has(parsedQualityCheck.id)) {
      throw new Error(`Invalid rubric.yaml: duplicate quality check id '${parsedQualityCheck.id}'.`);
    }

    qualityCheckIdSet.add(parsedQualityCheck.id);
  }

  return parsedQualityChecks;
}

function parseYamlScalar(rawValue: string): string {
  const trimmedValue = rawValue.trim();
  if (trimmedValue.length === 0) {
    return "";
  }

  if (trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) {
    const innerValue = trimmedValue.slice(1, -1);
    return innerValue
      .replaceAll("\\n", "\n")
      .replaceAll('\\"', '"')
      .replaceAll("\\\\", "\\")
      .trim();
  }

  if (trimmedValue.startsWith("'") && trimmedValue.endsWith("'")) {
    return trimmedValue.slice(1, -1).replaceAll("''", "'").trim();
  }

  return trimmedValue;
}

function sanitizeArtifactSegment(rawSegment: string): string {
  let sanitizedSegment = "";

  for (const currentCharacter of rawSegment.toLowerCase()) {
    if ((currentCharacter >= "a" && currentCharacter <= "z") || (currentCharacter >= "0" && currentCharacter <= "9")) {
      sanitizedSegment += currentCharacter;
      continue;
    }

    if (currentCharacter === "-" || currentCharacter === "_") {
      sanitizedSegment += currentCharacter;
      continue;
    }

    sanitizedSegment += "-";
  }

  const compactedSegment = sanitizedSegment.replaceAll(/-+/g, "-").replaceAll(/^[-_]+|[-_]+$/g, "");
  if (compactedSegment.length > 0) {
    return compactedSegment;
  }

  return "check";
}
