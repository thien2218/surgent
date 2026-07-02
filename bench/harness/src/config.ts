import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PromptScript, TaskDefinition } from "./types.js";
import { validatePromptScript } from "./types.js";

interface PinnedModelPricing {
  pricingModelId: string;
  matchPrefixes: string[];
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
  cachedInputUsdPerMillionTokens: number | null;
}

export interface ResolvedModelPricing {
  pricingVersion: string;
  pricingModelId: string | null;
  inputUsdPerMillionTokens: number | null;
  outputUsdPerMillionTokens: number | null;
  cachedInputUsdPerMillionTokens: number | null;
}

export const PINNED_PRICING_VERSION = "2026-07-02";

const PINNED_MODEL_PRICING_TABLE: PinnedModelPricing[] = [
  {
    pricingModelId: "claude-sonnet-4-6",
    matchPrefixes: ["claude-sonnet-4-6", "claude-sonnet-4"],
    inputUsdPerMillionTokens: 3,
    outputUsdPerMillionTokens: 15,
    cachedInputUsdPerMillionTokens: 0.3,
  },
  {
    pricingModelId: "gpt-5.4",
    matchPrefixes: ["gpt-5.4", "gpt-5"],
    inputUsdPerMillionTokens: 1.25,
    outputUsdPerMillionTokens: 10,
    cachedInputUsdPerMillionTokens: 0.125,
  },
];

export function getDefaultTasksRootPath(): string {
  return path.resolve(fileURLToPath(new URL("../../tasks", import.meta.url)));
}

export function resolveModelPricing(modelId: string | null): ResolvedModelPricing {
  if (modelId === null || modelId.trim().length === 0) {
    return {
      pricingVersion: PINNED_PRICING_VERSION,
      pricingModelId: null,
      inputUsdPerMillionTokens: null,
      outputUsdPerMillionTokens: null,
      cachedInputUsdPerMillionTokens: null,
    };
  }

  const normalizedModelId = modelId.trim().toLowerCase();

  for (const pricingRow of PINNED_MODEL_PRICING_TABLE) {
    for (const matchPrefix of pricingRow.matchPrefixes) {
      if (!normalizedModelId.startsWith(matchPrefix.toLowerCase())) {
        continue;
      }

      return {
        pricingVersion: PINNED_PRICING_VERSION,
        pricingModelId: pricingRow.pricingModelId,
        inputUsdPerMillionTokens: pricingRow.inputUsdPerMillionTokens,
        outputUsdPerMillionTokens: pricingRow.outputUsdPerMillionTokens,
        cachedInputUsdPerMillionTokens: pricingRow.cachedInputUsdPerMillionTokens,
      };
    }
  }

  return {
    pricingVersion: PINNED_PRICING_VERSION,
    pricingModelId: null,
    inputUsdPerMillionTokens: null,
    outputUsdPerMillionTokens: null,
    cachedInputUsdPerMillionTokens: null,
  };
}

export async function loadTaskDefinition(taskId: string, tasksRootPath: string): Promise<TaskDefinition> {
  const taskDirPath = path.join(tasksRootPath, taskId);
  await assertPathExists(taskDirPath, `Task directory not found: ${taskDirPath}`, true);

  const repoDirPath = path.join(taskDirPath, "repo");
  const promptsFilePath = path.join(taskDirPath, "prompts.yaml");
  const visibleTestsPath = path.join(taskDirPath, "visible-tests.sh");
  const hiddenTestsPath = path.join(taskDirPath, "hidden-tests.sh");
  const rubricPath = path.join(taskDirPath, "rubric.yaml");

  await assertPathExists(repoDirPath, `Missing required repo directory: ${repoDirPath}`, true);
  await assertPathExists(promptsFilePath, `Missing required prompts.yaml: ${promptsFilePath}`, false);
  await assertPathExists(visibleTestsPath, `Missing required visible-tests.sh: ${visibleTestsPath}`, false);
  await assertPathExists(hiddenTestsPath, `Missing required hidden-tests.sh: ${hiddenTestsPath}`, false);

  const promptScript = validatePromptScript(parsePromptsYaml(await readFile(promptsFilePath, "utf8")));

  let optionalRubricPath: string | null = null;
  try {
    await access(rubricPath);
    optionalRubricPath = rubricPath;
  } catch {
    optionalRubricPath = null;
  }

  return {
    id: taskId,
    taskDirPath,
    repoDirPath,
    promptsFilePath,
    visibleTestsPath,
    hiddenTestsPath,
    rubricPath: optionalRubricPath,
    promptScript,
  };
}

function parsePromptsYaml(fileContent: string): PromptScript {
  const fileLines = fileContent.split(/\r?\n/);
  let currentLineIndex = 0;
  let sessionGoalValue: string | null = null;
  let foundTurnsSection = false;
  const parsedTurns: { id: string; prompt: string }[] = [];

  // naive scan - index if perf matters
  while (currentLineIndex < fileLines.length) {
    const rawLine = fileLines[currentLineIndex] ?? "";
    const trimmedLine = rawLine.trim();

    if (trimmedLine.length === 0 || trimmedLine.startsWith("#")) {
      currentLineIndex += 1;
      continue;
    }

    if (sessionGoalValue === null) {
      if (!trimmedLine.startsWith("session_goal:")) {
        throw new Error(`Invalid prompts.yaml at line ${currentLineIndex + 1}: expected session_goal.`);
      }
      sessionGoalValue = parseYamlScalar(trimmedLine.slice("session_goal:".length));
      currentLineIndex += 1;
      continue;
    }

    if (!foundTurnsSection) {
      if (trimmedLine !== "turns:") {
        throw new Error(`Invalid prompts.yaml at line ${currentLineIndex + 1}: expected turns: section.`);
      }
      foundTurnsSection = true;
      currentLineIndex += 1;
      continue;
    }

    if (!trimmedLine.startsWith("- id:")) {
      throw new Error(`Invalid prompts.yaml at line ${currentLineIndex + 1}: expected '- id: ...'.`);
    }

    const parsedId = parseYamlScalar(trimmedLine.slice("- id:".length));
    if (parsedId.length === 0) {
      throw new Error(`Invalid prompts.yaml at line ${currentLineIndex + 1}: turn id cannot be empty.`);
    }

    currentLineIndex += 1;

    while (currentLineIndex < fileLines.length) {
      const promptLine = fileLines[currentLineIndex] ?? "";
      if (promptLine.trim().length === 0 || promptLine.trim().startsWith("#")) {
        currentLineIndex += 1;
        continue;
      }

      const trimmedPromptLine = promptLine.trim();
      if (!trimmedPromptLine.startsWith("prompt:")) {
        throw new Error(`Invalid prompts.yaml at line ${currentLineIndex + 1}: expected prompt field.`);
      }

      const parsedPrompt = parseYamlScalar(trimmedPromptLine.slice("prompt:".length));
      if (parsedPrompt.length === 0) {
        throw new Error(`Invalid prompts.yaml at line ${currentLineIndex + 1}: prompt cannot be empty.`);
      }

      parsedTurns.push({ id: parsedId, prompt: parsedPrompt });
      currentLineIndex += 1;
      break;
    }
  }

  if (sessionGoalValue === null) {
    throw new Error("Invalid prompts.yaml: missing session_goal.");
  }

  if (!foundTurnsSection) {
    throw new Error("Invalid prompts.yaml: missing turns section.");
  }

  if (parsedTurns.length === 0) {
    throw new Error("Invalid prompts.yaml: at least one turn is required.");
  }

  return {
    session_goal: sessionGoalValue,
    turns: parsedTurns,
  };
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

async function assertPathExists(filePath: string, errorMessage: string, expectDirectory: boolean): Promise<void> {
  let pathStats;
  try {
    pathStats = await stat(filePath);
  } catch {
    throw new Error(errorMessage);
  }

  if (expectDirectory && !pathStats.isDirectory()) {
    throw new Error(errorMessage);
  }

  if (!expectDirectory && !pathStats.isFile()) {
    throw new Error(errorMessage);
  }
}
