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

  const totalInputTokens = uncachedInputTokens + cachedReadTokens;
  const cacheHitDenominator = cachedReadTokens + uncachedInputTokens;

  return {
    inputTokens: Math.round(totalInputTokens),
    outputTokens: Math.round(outputTokens),
    totalTokens: Math.round(totalTokens),
    cacheHit: cacheHitDenominator > 0 ? cachedReadTokens / cacheHitDenominator : 0,
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
  let highestInputTokens = -1;
  let highestOutputTokens = -1;
  let highestCachedReadTokens = 0;
  let highestTotalTokens = -1;
  let highestCostUsd = -1;
  let summedInputTokens = 0;
  let summedCachedReadTokens = 0;
  let hasSummedInputTokens = false;

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

    if (parsedLine?.type === 'span') {
      const spanAttributes = parsedLine?.attributes;
      const spanInputTokens = parseNumericValue(spanAttributes?.['gen_ai.usage.input_tokens']);
      const spanOutputTokens = parseNumericValue(spanAttributes?.['gen_ai.usage.output_tokens']);
      const spanCachedReadTokens = parseNumericValue(spanAttributes?.['gen_ai.usage.cache_read.input_tokens']);
      const spanTotalTokens = parseNumericValue(spanAttributes?.['gen_ai.usage.total_tokens']);
      const spanCostUsd = parseNumericValue(spanAttributes?.['github.copilot.cost']);

      if (Number.isFinite(spanInputTokens)) {
        hasSummedInputTokens = true;
        summedInputTokens += spanInputTokens;
        if (spanInputTokens > highestInputTokens) {
          highestInputTokens = spanInputTokens;
        }
      }
      if (Number.isFinite(spanOutputTokens) && spanOutputTokens > highestOutputTokens) {
        highestOutputTokens = spanOutputTokens;
      }
      if (Number.isFinite(spanCachedReadTokens)) {
        summedCachedReadTokens += spanCachedReadTokens;
        if (spanCachedReadTokens > highestCachedReadTokens) {
          highestCachedReadTokens = spanCachedReadTokens;
        }
      }
      if (Number.isFinite(spanTotalTokens) && spanTotalTokens > highestTotalTokens) {
        highestTotalTokens = spanTotalTokens;
      }
      if (Number.isFinite(spanCostUsd) && spanCostUsd > highestCostUsd) {
        highestCostUsd = spanCostUsd;
      }
      continue;
    }

    if (parsedLine?.type !== 'metric' || !Array.isArray(parsedLine?.dataPoints)) {
      continue;
    }

    if (parsedLine.name === 'gen_ai.client.token.usage') {
      for (const dataPoint of parsedLine.dataPoints) {
        const tokenType = dataPoint?.attributes?.['gen_ai.token.type'];
        const tokenSum = parseNumericValue(typeof dataPoint?.value?.sum === 'number' ? dataPoint.value.sum : dataPoint?.value);
        if (tokenType === 'input' && Number.isFinite(tokenSum) && tokenSum > highestInputTokens) {
          highestInputTokens = tokenSum;
        }
        if (tokenType === 'output' && Number.isFinite(tokenSum) && tokenSum > highestOutputTokens) {
          highestOutputTokens = tokenSum;
        }
        if (typeof tokenType === 'string' && tokenType.includes('cache') && Number.isFinite(tokenSum) && tokenSum > highestCachedReadTokens) {
          highestCachedReadTokens = tokenSum;
        }
      }
      continue;
    }

    if (parsedLine.name === 'gen_ai.client.operation.cost' || parsedLine.name === 'gen_ai.client.request.cost' || parsedLine.name === 'gen_ai.client.cost') {
      for (const dataPoint of parsedLine.dataPoints) {
        const costSum = parseNumericValue(typeof dataPoint?.value?.sum === 'number' ? dataPoint.value.sum : dataPoint?.value);
        if (Number.isFinite(costSum) && costSum > highestCostUsd) {
          highestCostUsd = costSum;
        }
      }
    }
  }

  const resolvedInputTokens = hasSummedInputTokens ? summedInputTokens : highestInputTokens;

  if (resolvedInputTokens < 0 || highestOutputTokens < 0) {
    fail(`Invalid copilot usage in ${newestOtelFilePath}`);
  }

  const totalTokens = highestTotalTokens >= 0 ? highestTotalTokens : resolvedInputTokens + highestOutputTokens;
  const cacheHitDenominator = resolvedInputTokens;
  const cacheHitNumerator = hasSummedInputTokens ? summedCachedReadTokens : highestCachedReadTokens;

  return {
    inputTokens: Math.round(resolvedInputTokens),
    outputTokens: Math.round(highestOutputTokens),
    totalTokens: Math.round(totalTokens),
    cacheHit: cacheHitDenominator > 0 ? cacheHitNumerator / cacheHitDenominator : 0,
    totalCostUsd: highestCostUsd < 0 ? null : highestCostUsd
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
