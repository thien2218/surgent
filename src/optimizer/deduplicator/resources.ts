import { realpathSync } from "node:fs";
import { normalize, resolve } from "node:path";
import { isRecord } from "../../utils.js";
import { parseInspectToolDetails } from "../inspector/helpers.js";
import type { Range } from "../inspector/types.js";

export interface ResourceCoverage {
  resource: string;
  range: Range;
}

function getResultText(message: Record<string, unknown>): string | undefined {
  if (!Array.isArray(message.content) || message.content.length !== 1) return;

  const content = message.content[0];
  if (!isRecord(content) || content.type !== "text" || typeof content.text !== "string") return;
  return content.text;
}

function normalizeResourcePath(sourcePath: string, cwd: string): string {
  const absolutePath = resolve(cwd, sourcePath);
  try {
    return normalize(realpathSync(absolutePath));
  } catch {
    return normalize(absolutePath);
  }
}

export function getResourceCoverage(
  toolName: string,
  input: Record<string, unknown>,
  result: unknown,
  cwd: string,
): ResourceCoverage | undefined {
  if (!isRecord(result)) return;

  if (toolName === "inspect") {
    const inspected = parseInspectToolDetails(result.details);
    if (!inspected) return;
    return {
      resource: normalizeResourcePath(inspected.path, cwd),
      range: inspected.range,
    };
  }

  if (toolName !== "read") return;
  const sourcePath = input.path;
  const offset = input.offset;
  if (typeof sourcePath !== "string" || sourcePath.length === 0) return;
  if (
    offset !== undefined &&
    (typeof offset !== "number" || !Number.isInteger(offset) || offset < 1)
  ) {
    return;
  }

  const details = isRecord(result.details) ? result.details : undefined;
  const truncation = details?.truncation;
  if (truncation !== undefined && !isRecord(truncation)) return;
  if (isRecord(truncation) && truncation.firstLineExceedsLimit === true) return;

  const resultText = getResultText(result);
  if (resultText === undefined) return;
  const continuation = resultText.match(/\n\n\[[^\n]*Use offset=\d+ to continue\.\]$/)?.[0];
  const visibleText = continuation ? resultText.slice(0, -continuation.length) : resultText;
  const outputLines =
    isRecord(truncation) && truncation.truncated === true
      ? truncation.outputLines
      : visibleText.split("\n").length;
  if (typeof outputLines !== "number" || !Number.isInteger(outputLines) || outputLines <= 0) return;

  const start = typeof offset === "number" ? offset : 1;
  return {
    resource: normalizeResourcePath(sourcePath, cwd),
    range: [start, start + outputLines - 1],
  };
}
