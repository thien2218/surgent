import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BenchmarkAgent, parseBenchmarkAgent, type BenchmarkRunRecord } from "../types.js";

interface SummaryRow {
  agent: BenchmarkAgent;
  runCount: number;
  hiddenSuccessRatePct: number;
  medianCompletionMs: number;
  p90CompletionMs: number;
  medianTokenTotal: number | null;
  p90TokenTotal: number | null;
  medianContextPeakPct: number | null;
  p90ContextPeakPct: number | null;
  estimatedCostPerRunUsd: number | null;
  estimatedCostPerSuccessfulRunUsd: number | null;
}

export interface WriteSummaryReportRequest {
  inputJsonlPath: string;
  reportsDirPath: string;
}

export interface WriteSummaryReportResult {
  summaryCsvPath: string;
  summaryMarkdownPath: string;
  rows: SummaryRow[];
  runCount: number;
}

export async function writeSummaryReport(request: WriteSummaryReportRequest): Promise<WriteSummaryReportResult> {
  const jsonlFileContent = await readFile(request.inputJsonlPath, "utf8");
  const runRecords: BenchmarkRunRecord[] = [];

  const jsonlLines = jsonlFileContent.split(/\r?\n/);
  let lineNumber = 0;
  for (const jsonlLine of jsonlLines) {
    lineNumber += 1;

    const trimmedLine = jsonlLine.trim();
    if (trimmedLine.length === 0) {
      continue;
    }

    let parsedLine: unknown;
    try {
      parsedLine = JSON.parse(trimmedLine);
    } catch (error) {
      const parseErrorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid run JSONL at line ${lineNumber}: ${parseErrorMessage}`);
    }

    const runRecord = parsedLine as BenchmarkRunRecord;
    parseBenchmarkAgent(String(runRecord.agent));
    runRecords.push(runRecord);
  }

  if (runRecords.length === 0) {
    throw new Error(`No run records found in JSONL file: ${request.inputJsonlPath}`);
  }

  const runRecordsByAgent = new Map<BenchmarkAgent, BenchmarkRunRecord[]>();
  for (const runRecord of runRecords) {
    const validatedAgent = parseBenchmarkAgent(String(runRecord.agent));
    const existingAgentRuns = runRecordsByAgent.get(validatedAgent);
    if (existingAgentRuns) {
      existingAgentRuns.push(runRecord);
      continue;
    }
    runRecordsByAgent.set(validatedAgent, [runRecord]);
  }

  const rows: SummaryRow[] = [];
  for (const orderedAgent of [BenchmarkAgent.Surgent, BenchmarkAgent.Copilot]) {
    const agentRunRecords = runRecordsByAgent.get(orderedAgent);
    if (!agentRunRecords || agentRunRecords.length === 0) {
      continue;
    }

    const completionDurationsMs: number[] = [];
    const tokenTotals: number[] = [];
    const contextPeaksPct: number[] = [];
    const costValuesPerRunUsd: number[] = [];
    const costValuesPerSuccessfulRunUsd: number[] = [];
    let hiddenSuccessCount = 0;

    for (const agentRunRecord of agentRunRecords) {
      completionDurationsMs.push(agentRunRecord.sessionMetrics.durationMsTotal);

      if (agentRunRecord.sessionMetrics.tokensInTotal !== null && agentRunRecord.sessionMetrics.tokensOutTotal !== null) {
        tokenTotals.push(agentRunRecord.sessionMetrics.tokensInTotal + agentRunRecord.sessionMetrics.tokensOutTotal);
      }

      if (agentRunRecord.sessionMetrics.contextUsedPctPeak !== null) {
        contextPeaksPct.push(agentRunRecord.sessionMetrics.contextUsedPctPeak);
      }

      if (agentRunRecord.sessionMetrics.sessionCost.totalCostUsd !== null) {
        costValuesPerRunUsd.push(agentRunRecord.sessionMetrics.sessionCost.totalCostUsd);
      }

      if (agentRunRecord.grading.pass_hidden) {
        hiddenSuccessCount += 1;

        if (agentRunRecord.sessionMetrics.sessionCost.totalCostUsd !== null) {
          costValuesPerSuccessfulRunUsd.push(agentRunRecord.sessionMetrics.sessionCost.totalCostUsd);
        }
      }
    }

    completionDurationsMs.sort((firstDurationMs, secondDurationMs) => firstDurationMs - secondDurationMs);
    tokenTotals.sort((firstTokenTotal, secondTokenTotal) => firstTokenTotal - secondTokenTotal);
    contextPeaksPct.sort((firstContextPeakPct, secondContextPeakPct) => firstContextPeakPct - secondContextPeakPct);

    let estimatedCostPerRunUsd: number | null = null;
    if (costValuesPerRunUsd.length > 0) {
      let costTotalPerRunUsd = 0;
      for (const costValuePerRunUsd of costValuesPerRunUsd) {
        costTotalPerRunUsd += costValuePerRunUsd;
      }
      estimatedCostPerRunUsd = costTotalPerRunUsd / costValuesPerRunUsd.length;
    }

    let estimatedCostPerSuccessfulRunUsd: number | null = null;
    if (costValuesPerSuccessfulRunUsd.length > 0) {
      let costTotalPerSuccessfulRunUsd = 0;
      for (const costValuePerSuccessfulRunUsd of costValuesPerSuccessfulRunUsd) {
        costTotalPerSuccessfulRunUsd += costValuePerSuccessfulRunUsd;
      }
      estimatedCostPerSuccessfulRunUsd = costTotalPerSuccessfulRunUsd / costValuesPerSuccessfulRunUsd.length;
    }

    rows.push({
      agent: orderedAgent,
      runCount: agentRunRecords.length,
      hiddenSuccessRatePct: (hiddenSuccessCount / agentRunRecords.length) * 100,
      medianCompletionMs: calculateNearestRankPercentile(completionDurationsMs, 50),
      p90CompletionMs: calculateNearestRankPercentile(completionDurationsMs, 90),
      medianTokenTotal: calculateNearestRankPercentile(tokenTotals, 50),
      p90TokenTotal: calculateNearestRankPercentile(tokenTotals, 90),
      medianContextPeakPct: calculateNearestRankPercentile(contextPeaksPct, 50),
      p90ContextPeakPct: calculateNearestRankPercentile(contextPeaksPct, 90),
      estimatedCostPerRunUsd,
      estimatedCostPerSuccessfulRunUsd,
    });
  }

  await mkdir(request.reportsDirPath, { recursive: true });

  const summaryCsvPath = path.join(request.reportsDirPath, "summary.csv");
  const summaryMarkdownPath = path.join(request.reportsDirPath, "summary.md");

  const summaryCsvLines: string[] = [
    [
      "agent",
      "runs",
      "hidden_success_rate_pct",
      "median_completion_ms",
      "p90_completion_ms",
      "median_token_total",
      "p90_token_total",
      "median_context_peak_pct",
      "p90_context_peak_pct",
      "estimated_cost_per_run_usd",
      "estimated_cost_per_successful_run_usd",
    ].join(","),
  ];

  for (const summaryRow of rows) {
    summaryCsvLines.push(
      [
        summaryRow.agent,
        String(summaryRow.runCount),
        summaryRow.hiddenSuccessRatePct.toFixed(2),
        String(summaryRow.medianCompletionMs),
        String(summaryRow.p90CompletionMs),
        summaryRow.medianTokenTotal === null ? "" : String(summaryRow.medianTokenTotal),
        summaryRow.p90TokenTotal === null ? "" : String(summaryRow.p90TokenTotal),
        summaryRow.medianContextPeakPct === null ? "" : summaryRow.medianContextPeakPct.toFixed(2),
        summaryRow.p90ContextPeakPct === null ? "" : summaryRow.p90ContextPeakPct.toFixed(2),
        summaryRow.estimatedCostPerRunUsd === null ? "" : summaryRow.estimatedCostPerRunUsd.toFixed(6),
        summaryRow.estimatedCostPerSuccessfulRunUsd === null
          ? ""
          : summaryRow.estimatedCostPerSuccessfulRunUsd.toFixed(6),
      ].join(","),
    );
  }

  await writeFile(summaryCsvPath, `${summaryCsvLines.join("\n")}\n`, "utf8");

  const summaryMarkdownLines: string[] = [
    "# Benchmark Summary",
    "",
    `Source JSONL: \`${request.inputJsonlPath}\``,
    `Generated at: ${new Date().toISOString()}`,
    "Percentile method: nearest-rank.",
    "",
    "| Agent | Runs | Hidden success rate | Median completion (ms) | P90 completion (ms) | Median token total | P90 token total | Median context peak (%) | P90 context peak (%) | Est. cost/run (USD) | Est. cost/successful run (USD) |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const summaryRow of rows) {
    summaryMarkdownLines.push(
      `| ${summaryRow.agent} | ${summaryRow.runCount} | ${summaryRow.hiddenSuccessRatePct.toFixed(2)}% | ${summaryRow.medianCompletionMs} | ${summaryRow.p90CompletionMs} | ${summaryRow.medianTokenTotal === null ? "N/A" : String(summaryRow.medianTokenTotal)} | ${summaryRow.p90TokenTotal === null ? "N/A" : String(summaryRow.p90TokenTotal)} | ${summaryRow.medianContextPeakPct === null ? "N/A" : summaryRow.medianContextPeakPct.toFixed(2)} | ${summaryRow.p90ContextPeakPct === null ? "N/A" : summaryRow.p90ContextPeakPct.toFixed(2)} | ${summaryRow.estimatedCostPerRunUsd === null ? "N/A" : summaryRow.estimatedCostPerRunUsd.toFixed(6)} | ${summaryRow.estimatedCostPerSuccessfulRunUsd === null ? "N/A" : summaryRow.estimatedCostPerSuccessfulRunUsd.toFixed(6)} |`,
    );
  }

  await writeFile(summaryMarkdownPath, `${summaryMarkdownLines.join("\n")}\n`, "utf8");

  return {
    summaryCsvPath,
    summaryMarkdownPath,
    rows,
    runCount: runRecords.length,
  };
}

function calculateNearestRankPercentile(sortedValues: number[], percentileTarget: number): number | null {
  if (sortedValues.length === 0) {
    return null;
  }

  const percentileAsFraction = percentileTarget / 100;
  const computedRank = Math.ceil(percentileAsFraction * sortedValues.length);
  const normalizedIndex = Math.min(sortedValues.length - 1, Math.max(0, computedRank - 1));
  const percentileValue = sortedValues[normalizedIndex];

  if (percentileValue === undefined) {
    return null;
  }

  return Math.round(percentileValue * 100) / 100;
}
