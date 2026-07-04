import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

function fail(message) {
  throw new Error(message);
}

function parseNumericValue(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : Number.NaN;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? parsedValue : Number.NaN;
  }
  return Number.NaN;
}

async function listJsonlFilePaths(rootDirectoryPath) {
  const discoveredJsonlFilePaths = [];
  const pendingDirectoryPaths = [rootDirectoryPath];

  while (pendingDirectoryPaths.length > 0) {
    const currentDirectoryPath = pendingDirectoryPaths.pop();
    let directoryEntries;

    try {
      directoryEntries = await readdir(currentDirectoryPath, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') {
        continue;
      }
      throw error;
    }

    for (const directoryEntry of directoryEntries) {
      const entryPath = path.join(currentDirectoryPath, directoryEntry.name);
      if (directoryEntry.isDirectory()) {
        pendingDirectoryPaths.push(entryPath);
        continue;
      }
      if (directoryEntry.isFile() && directoryEntry.name.endsWith('.jsonl')) {
        discoveredJsonlFilePaths.push(entryPath);
      }
    }
  }

  return discoveredJsonlFilePaths;
}

async function pickNewestFilePath(filePaths) {
  let newestFilePath = null;
  let newestModifiedTimeMs = -1;

  for (const filePath of filePaths) {
    const fileStat = await stat(filePath);
    if (fileStat.mtimeMs > newestModifiedTimeMs) {
      newestModifiedTimeMs = fileStat.mtimeMs;
      newestFilePath = filePath;
    }
  }

  return newestFilePath;
}

async function parseSurgentUsage(sessionRootDirectoryPath) {
  const jsonlFilePaths = await listJsonlFilePaths(sessionRootDirectoryPath);
  if (jsonlFilePaths.length === 0) {
    fail(`Missing surgent session log in ${sessionRootDirectoryPath}`);
  }

  const newestSessionFilePath = await pickNewestFilePath(jsonlFilePaths);
  const sessionText = await readFile(newestSessionFilePath, 'utf8');
  let uncachedInputTokens = 0;
  let outputTokens = 0;
  let cachedReadTokens = 0;
  let totalTokens = 0;
  let totalCostUsd = 0;
  let hasTotalCostUsd = true;
  let assistantMessageCount = 0;

  for (const lineText of sessionText.split(/\r?\n/)) {
    if (lineText.trim() === '') {
      continue;
    }

    let parsedLine;
    try {
      parsedLine = JSON.parse(lineText);
    } catch {
      continue;
    }

    if (parsedLine?.type !== 'message' || parsedLine?.message?.role !== 'assistant') {
      continue;
    }

    const messageUsage = parsedLine.message?.usage;
    const messageInputTokens = parseNumericValue(messageUsage?.input);
    const messageOutputTokens = parseNumericValue(messageUsage?.output);

    if (!Number.isFinite(messageInputTokens) || !Number.isFinite(messageOutputTokens)) {
      fail(`Invalid surgent usage in ${newestSessionFilePath}`);
    }

    const messageCachedReadTokens = parseNumericValue(messageUsage?.cacheRead);
    const messageCacheWriteTokens = parseNumericValue(messageUsage?.cacheWrite);
    const messageTotalTokens = parseNumericValue(messageUsage?.totalTokens);

    assistantMessageCount += 1;
    uncachedInputTokens += messageInputTokens;
    outputTokens += messageOutputTokens;
    cachedReadTokens += Number.isFinite(messageCachedReadTokens) ? messageCachedReadTokens : 0;

    if (Number.isFinite(messageTotalTokens)) {
      totalTokens += messageTotalTokens;
    } else {
      totalTokens +=
        messageInputTokens +
        messageOutputTokens +
        (Number.isFinite(messageCachedReadTokens) ? messageCachedReadTokens : 0) +
        (Number.isFinite(messageCacheWriteTokens) ? messageCacheWriteTokens : 0);
    }

    const messageTotalCostUsd = parseNumericValue(messageUsage?.cost?.total);
    if (Number.isFinite(messageTotalCostUsd)) {
      totalCostUsd += messageTotalCostUsd;
    } else {
      hasTotalCostUsd = false;
    }
  }

  if (assistantMessageCount === 0) {
    fail(`No assistant usage found in ${newestSessionFilePath}`);
  }

  const inputTokensWithCache = uncachedInputTokens + cachedReadTokens;
  const cacheHit = inputTokensWithCache > 0 ? cachedReadTokens / inputTokensWithCache : 0;
  const inputTokens = Math.max(0, inputTokensWithCache * (1 - cacheHit));

  return {
    inputTokens: Math.round(inputTokens),
    outputTokens: Math.round(outputTokens),
    totalTokens: Math.round(totalTokens),
    cacheHit,
    totalCostUsd: hasTotalCostUsd ? totalCostUsd : null
  };
}

async function parseCopilotUsage(sessionRootDirectoryPath) {
  const jsonlFilePaths = await listJsonlFilePaths(sessionRootDirectoryPath);
  if (jsonlFilePaths.length === 0) {
    fail(`Missing copilot OTel log in ${sessionRootDirectoryPath}`);
  }

  const newestOtelFilePath = await pickNewestFilePath(jsonlFilePaths);
  const otelText = await readFile(newestOtelFilePath, 'utf8');
  let invokeAgentSpanCount = 0;
  let summedInputTokens = 0;
  let summedOutputTokens = 0;
  let summedCachedReadTokens = 0;
  let summedTotalTokens = 0;
  let summedCopilotCostCredits = 0;
  let hasSummedTotalTokens = false;
  let hasSummedCopilotCostCredits = false;

  for (const lineText of otelText.split(/\r?\n/)) {
    if (lineText.trim() === '') {
      continue;
    }

    let parsedLine;
    try {
      parsedLine = JSON.parse(lineText);
    } catch {
      continue;
    }

    if (parsedLine?.type !== 'span' || parsedLine?.name !== 'invoke_agent') {
      continue;
    }

    const spanAttributes = parsedLine.attributes;
    const spanInputTokens = parseNumericValue(spanAttributes?.['gen_ai.usage.input_tokens']);
    const spanOutputTokens = parseNumericValue(spanAttributes?.['gen_ai.usage.output_tokens']);

    if (!Number.isFinite(spanInputTokens) || !Number.isFinite(spanOutputTokens)) {
      fail(`Invalid invoke_agent usage in ${newestOtelFilePath}`);
    }

    invokeAgentSpanCount += 1;
    summedInputTokens += spanInputTokens;
    summedOutputTokens += spanOutputTokens;

    const spanCachedReadTokens = parseNumericValue(spanAttributes?.['gen_ai.usage.cache_read.input_tokens']);
    if (Number.isFinite(spanCachedReadTokens)) {
      summedCachedReadTokens += spanCachedReadTokens;
    }

    const spanTotalTokens = parseNumericValue(spanAttributes?.['gen_ai.usage.total_tokens']);
    if (Number.isFinite(spanTotalTokens)) {
      hasSummedTotalTokens = true;
      summedTotalTokens += spanTotalTokens;
    }

    const spanCopilotCostCredits = parseNumericValue(spanAttributes?.['github.copilot.cost']);
    if (Number.isFinite(spanCopilotCostCredits)) {
      hasSummedCopilotCostCredits = true;
      summedCopilotCostCredits += spanCopilotCostCredits;
    }
  }

  if (invokeAgentSpanCount === 0) {
    fail(`No invoke_agent spans found in ${newestOtelFilePath}`);
  }

  const totalTokens = hasSummedTotalTokens ? summedTotalTokens : summedInputTokens + summedOutputTokens;
  const inputTokensWithCache = summedInputTokens;
  const cacheHit = inputTokensWithCache > 0 ? summedCachedReadTokens / inputTokensWithCache : 0;
  const inputTokens = Math.max(0, inputTokensWithCache * (1 - cacheHit));

  return {
    inputTokens: Math.round(inputTokens),
    outputTokens: Math.round(summedOutputTokens),
    totalTokens: Math.round(totalTokens),
    cacheHit,
    totalCostUsd: hasSummedCopilotCostCredits ? summedCopilotCostCredits * 0.01 : null
  };
}

export async function readUsageMetricsForRunnerSession(runnerName, sessionRootDirectoryPath) {
  if (runnerName === 'surgent') {
    return parseSurgentUsage(sessionRootDirectoryPath);
  }
  if (runnerName === 'copilot') {
    return parseCopilotUsage(sessionRootDirectoryPath);
  }

  fail(`Unsupported runner for usage parsing: ${runnerName}`);
}
