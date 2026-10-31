"""API-equivalent prices from pi's `openai` catalog: the subscription has no per-token bill."""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import cache
from pathlib import Path

from surgent_bench.settings import REPO_DIR
from surgent_bench.usage import Call

# Decimal places for stored costs; sums use unrounded values.
COST_DIGITS = 4

PI_CATALOG = (
    REPO_DIR / "node_modules" / "@earendil-works" / "pi-ai" / "dist" / "providers" / "data"
    / "openai.json"
)
PER_TOKEN = 1_000_000


@dataclass(frozen=True)
class Rates:
    """USD per million tokens."""

    input: float
    output: float
    cache_read: float
    cache_write: float


@dataclass(frozen=True)
class Price:
    base: Rates
    tier_above: int | None = None
    tier: Rates | None = None

    def rates_for(self, prompt_tokens: int) -> Rates:
        if self.tier is not None and self.tier_above is not None and prompt_tokens > self.tier_above:
            return self.tier
        return self.base


def _rates(cost: dict) -> Rates:
    return Rates(
        input=float(cost.get("input", 0)),
        output=float(cost.get("output", 0)),
        cache_read=float(cost.get("cacheRead", 0)),
        cache_write=float(cost.get("cacheWrite", 0)),
    )


@cache
def load_prices(path: Path = PI_CATALOG) -> dict[str, Price]:
    if not path.is_file():
        raise FileNotFoundError(f"Price catalog not found: {path} (run `pnpm install` in the repo)")
    prices: dict[str, Price] = {}
    for models in json.loads(path.read_text()).values():
        entries = models.values() if isinstance(models, dict) else models
        for model in entries:
            cost = model.get("cost") or {}
            tiers = cost.get("tiers") or []
            first_tier = tiers[0] if tiers else None
            prices[model["id"]] = Price(
                base=_rates(cost),
                tier_above=int(first_tier["inputTokensAbove"]) if first_tier else None,
                tier=_rates(first_tier) if first_tier else None,
            )
    return prices


def price_for(model: str) -> Price:
    model_id = model.split("/")[-1]
    prices = load_prices()
    if model_id not in prices:
        raise KeyError(f"No price for {model_id!r}; known: {', '.join(sorted(prices))}")
    return prices[model_id]


def call_cost(
    price: Price,
    uncached: int,
    cached: int,
    cache_write: int,
    output: int,
) -> float:
    """Cost of one model call; `output` includes reasoning tokens."""
    rates = price.rates_for(uncached + cached + cache_write)
    return (
        uncached * rates.input
        + cached * rates.cache_read
        + cache_write * rates.cache_write
        + output * rates.output
    ) / PER_TOKEN


def call_price(call: Call, fallback: Price) -> Price:
    """The call's own model price, or `fallback` when it logged none we know."""
    if call.model and call.model.split("/")[-1] in load_prices():
        return price_for(call.model)
    return fallback


def calls_cost(calls: list[Call], model: str) -> float:
    fallback = price_for(model)
    return sum(
        call_cost(call_price(call, fallback), call.uncached, call.cached, call.cache_write, call.output)
        for call in calls
    )
