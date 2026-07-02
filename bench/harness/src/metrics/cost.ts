import { resolveModelPricing } from "../config.js";
import type { SessionCostMetrics } from "../types.js";

export interface EstimateSessionCostRequest {
  modelId: string | null;
  tokensInTotal: number | null;
  tokensOutTotal: number | null;
  tokensCachedTotal: number | null;
}

export function estimateSessionCost(request: EstimateSessionCostRequest): SessionCostMetrics {
  const pricing = resolveModelPricing(request.modelId);
  const notes: string[] = [];

  if (
    pricing.pricingModelId === null ||
    pricing.inputUsdPerMillionTokens === null ||
    pricing.outputUsdPerMillionTokens === null
  ) {
    if (request.modelId === null || request.modelId.trim().length === 0) {
      notes.push("Model id missing, cost unavailable.");
    } else {
      notes.push(`Model '${request.modelId}' not found in pinned pricing table.`);
    }

    return {
      pricingVersion: pricing.pricingVersion,
      pricingModelId: null,
      inputCostUsd: null,
      outputCostUsd: null,
      cachedInputCostUsd: null,
      totalCostUsd: null,
      notes,
    };
  }

  const inputCostUsd =
    request.tokensInTotal === null
      ? null
      : Math.round((request.tokensInTotal / 1_000_000) * pricing.inputUsdPerMillionTokens * 1_000_000) / 1_000_000;

  const outputCostUsd =
    request.tokensOutTotal === null
      ? null
      : Math.round((request.tokensOutTotal / 1_000_000) * pricing.outputUsdPerMillionTokens * 1_000_000) / 1_000_000;

  const cachedInputCostUsd =
    request.tokensCachedTotal === null || pricing.cachedInputUsdPerMillionTokens === null
      ? null
      : Math.round(
          (request.tokensCachedTotal / 1_000_000) * pricing.cachedInputUsdPerMillionTokens * 1_000_000,
        ) / 1_000_000;

  if (request.tokensInTotal === null) {
    notes.push("tokensIn missing on one or more turns.");
  }

  if (request.tokensOutTotal === null) {
    notes.push("tokensOut missing on one or more turns.");
  }

  if (request.tokensCachedTotal === null) {
    notes.push("tokensCached missing on one or more turns.");
  }

  if (pricing.cachedInputUsdPerMillionTokens === null) {
    notes.push("Cached-token pricing unavailable for this model.");
  }

  const totalCostUsd =
    inputCostUsd === null || outputCostUsd === null || cachedInputCostUsd === null
      ? null
      : Math.round((inputCostUsd + outputCostUsd + cachedInputCostUsd) * 1_000_000) / 1_000_000;

  if (totalCostUsd === null) {
    notes.push("Total cost unavailable due to missing telemetry or pricing.");
  }

  return {
    pricingVersion: pricing.pricingVersion,
    pricingModelId: pricing.pricingModelId,
    inputCostUsd,
    outputCostUsd,
    cachedInputCostUsd,
    totalCostUsd,
    notes,
  };
}
