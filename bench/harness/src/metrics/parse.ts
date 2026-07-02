import { estimateSessionCost } from "./cost.js";
import type { NormalizedTurnTelemetry, SessionMetrics } from "../types.js";

export interface BuildSessionMetricsRequest {
  modelId: string | null;
  turns: NormalizedTurnTelemetry[];
}

export function buildSessionMetrics(request: BuildSessionMetricsRequest): SessionMetrics {
  let durationMsTotal = 0;

  let tokensInTotalValue = 0;
  let tokensOutTotalValue = 0;
  let tokensCachedTotalValue = 0;
  let toolCallsTotalValue = 0;

  let sawMissingTokensIn = false;
  let sawMissingTokensOut = false;
  let sawMissingTokensCached = false;
  let sawMissingToolCalls = false;

  let contextUsedPctPeakValue: number | null = null;
  let sawMissingContextUsedPct = false;

  for (const turnTelemetry of request.turns) {
    durationMsTotal += turnTelemetry.durationMs;

    if (turnTelemetry.tokensIn === null) {
      sawMissingTokensIn = true;
    } else {
      tokensInTotalValue += turnTelemetry.tokensIn;
    }

    if (turnTelemetry.tokensOut === null) {
      sawMissingTokensOut = true;
    } else {
      tokensOutTotalValue += turnTelemetry.tokensOut;
    }

    if (turnTelemetry.tokensCached === null) {
      sawMissingTokensCached = true;
    } else {
      tokensCachedTotalValue += turnTelemetry.tokensCached;
    }

    if (turnTelemetry.toolCalls === null) {
      sawMissingToolCalls = true;
    } else {
      toolCallsTotalValue += turnTelemetry.toolCalls;
    }

    if (turnTelemetry.contextUsedPct === null) {
      sawMissingContextUsedPct = true;
    } else if (contextUsedPctPeakValue === null || turnTelemetry.contextUsedPct > contextUsedPctPeakValue) {
      contextUsedPctPeakValue = turnTelemetry.contextUsedPct;
    }
  }

  const tokensInTotal = sawMissingTokensIn ? null : tokensInTotalValue;
  const tokensOutTotal = sawMissingTokensOut ? null : tokensOutTotalValue;
  const tokensCachedTotal = sawMissingTokensCached ? null : tokensCachedTotalValue;
  const toolCallsTotal = sawMissingToolCalls ? null : toolCallsTotalValue;

  const contextUsedPctPeak =
    request.turns.length === 0 ? null : sawMissingContextUsedPct ? null : contextUsedPctPeakValue;

  const sessionCost = estimateSessionCost({
    modelId: request.modelId,
    tokensInTotal,
    tokensOutTotal,
    tokensCachedTotal,
  });

  return {
    durationMsTotal,
    tokensInTotal,
    tokensOutTotal,
    tokensCachedTotal,
    contextUsedPctPeak,
    toolCallsTotal,
    sessionCost,
  };
}
