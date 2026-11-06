"""Turn Harbor trial folders into calls.csv, trials.csv, and summary.csv."""

from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Any

import pandas as pd

from surgent_bench.pricing import COST_DIGITS, call_cost, call_price, price_for
from surgent_bench.results import Trial, find_trials
from surgent_bench.settings import Suite
from surgent_bench.usage import SUBAGENT, harness_calls

UNRECORDED = "unrecorded"


def _suite(trial: Trial) -> str:
    return trial.job_name.split("/", 1)[0]


def _requested_effort(trial: Trial) -> str | None:
    for key in ("thinking", "reasoning_effort", "variant"):
        if trial.kwargs.get(key):
            return str(trial.kwargs[key])
    return None


def _joined(values: list[str | None]) -> str:
    counts = Counter(value for value in values if value)
    return ";".join(sorted(counts))


def owned_mask(trials: pd.DataFrame) -> pd.Series:
    """Trials of included tasks whose outcome the agent owned."""
    return trials["infra"].isna() & ~trials["excluded"].astype(bool)


def valid_mask(trials: pd.DataFrame) -> pd.Series:
    """Owned trials whose usage was logged."""
    return owned_mask(trials) & ~trials["usage_missing"].astype(bool)


def collect(
    jobs_dir: Path, out_dir: Path, suites: list[Suite], build: str
) -> dict[str, pd.DataFrame]:
    suites_by_name = {suite.name: suite for suite in suites}
    call_rows: list[dict[str, Any]] = []
    trial_rows: list[dict[str, Any]] = []
    for trial in find_trials(jobs_dir, build):
        suite = suites_by_name.get(_suite(trial))
        trial_price = price_for(trial.model or "")
        calls = harness_calls(trial.harness, trial.agent_dir)
        key = {
            "job": trial.job_name,
            "trial": trial.trial_dir.name,
            "attempt": trial.attempt,
            "harness": trial.harness,
            "suite": _suite(trial),
            "task": trial.task,
        }
        turn = 0
        cumulative = 0.0
        rows: list[dict[str, Any]] = []
        for call in calls:
            cost = call_cost(
                call_price(call, trial_price),
                call.uncached,
                call.cached,
                call.cache_write,
                call.output,
            )
            cumulative += cost
            if call.is_main:
                turn += 1
            rows.append(
                {
                    **key,
                    "timestamp": call.timestamp.isoformat(),
                    "role": call.role,
                    "is_main": call.is_main,
                    "turn": turn,
                    "prompt_tokens": call.prompt_tokens,
                    "uncached_tokens": call.uncached,
                    "cached_tokens": call.cached,
                    "cache_write_tokens": call.cache_write,
                    "output_tokens": call.output,
                    "reasoning_tokens": call.reasoning,
                    "cost_usd": cost,
                    "cumulative_cost_usd": cumulative,
                    "model": call.model,
                    "effort": call.effort,
                }
            )

        call_rows.extend(rows)
        main_calls = [call for call in calls if call.is_main]
        session_calls = [call for call in calls if call.role != SUBAGENT]
        duration = None
        if trial.agent_started_at and trial.agent_finished_at:
            duration = (trial.agent_finished_at - trial.agent_started_at).total_seconds()
        trial_rows.append(
            {
                **key,
                "agent_version": trial.agent_version,
                "model": trial.model,
                "observed_models": _joined([call.model for call in main_calls]),
                "effort": _requested_effort(trial),
                "observed_efforts": _joined([call.effort for call in main_calls]),
                "reward": trial.reward,
                "passed": trial.passed,
                "completed": trial.completed,
                "exception_type": trial.exception_type,
                "infra": trial.infra,
                "excluded": suite is not None and suite.excludes(trial.task),
                "usage_missing": not main_calls,
                "agent_seconds": duration,
                "turns": len(main_calls),
                "subagent_calls": len(calls) - len(session_calls),
                "peak_context": max((call.prompt_tokens for call in main_calls), default=0),
                "input_tokens": sum(call.prompt_tokens for call in session_calls),
                "cached_tokens": sum(call.cached for call in session_calls),
                "output_tokens": sum(call.output for call in session_calls),
                "cost_usd": sum(row["cost_usd"] for row in rows),
            }
        )

    trials = pd.DataFrame(trial_rows)
    frames = {"calls": pd.DataFrame(call_rows), "trials": trials}
    if trials.empty:
        # A cleared jobs directory must not wipe results collected earlier.
        return frames
    frames["summary"] = agent_summary(trials)
    out_dir.mkdir(parents=True, exist_ok=True)
    costs = dict.fromkeys(
        ("cost_usd", "cumulative_cost_usd", "avg_task_cost_usd", "p90_task_cost_usd"), COST_DIGITS
    )
    for name, frame in frames.items():
        frame.round(costs).to_csv(out_dir / f"{name}.csv", index=False)
    return frames


SUMMARY_COLUMNS = [
    "harness",
    "tasks",
    "trials",
    "score",
    "cost_usd",
    "avg_task_cost_usd",
    "p90_task_cost_usd",
    "cache_hit_rate",
    "input_tokens",
    "avg_task_input_tokens",
    "output_tokens",
    "avg_task_output_tokens",
]
# What one task takes; score already covers how much gets done.
PER_TASK = ["cost_usd", "input_tokens", "output_tokens"]


def shared_trials(trials: pd.DataFrame) -> pd.DataFrame:
    """Valid trials of each task, cut to as many as every agent has finished there."""
    valid = trials[valid_mask(trials)].sort_values(["job", "harness", "attempt"])
    if valid.empty:
        return valid
    harnesses = sorted(trials["harness"].unique())
    counts = valid.groupby(["job", "harness"]).size().unstack(fill_value=0)
    shared = counts.reindex(columns=harnesses, fill_value=0).min(axis=1)
    rank = valid.groupby(["job", "harness"]).cumcount()
    return valid[rank < valid["job"].map(shared)]


def agent_summary(trials: pd.DataFrame) -> pd.DataFrame:
    """One row per agent, over each task's trials that every agent has finished."""
    paired = shared_trials(trials)
    rows = []
    for harness, group in paired.groupby("harness", sort=True):
        input_tokens = int(group["input_tokens"].sum())
        # A task's usage is the mean over its trials, so every task weighs the same.
        per_task = group.groupby("job")[PER_TASK].mean()
        average = per_task.mean()
        rows.append(
            {
                "harness": harness,
                "tasks": len(per_task),
                "trials": len(group),
                "score": round(group["reward"].fillna(0).sum() / len(group), 3),
                "cost_usd": group["cost_usd"].sum(),
                "avg_task_cost_usd": average["cost_usd"],
                "p90_task_cost_usd": per_task["cost_usd"].quantile(0.9),
                "cache_hit_rate": round(group["cached_tokens"].sum() / max(input_tokens, 1), 3),
                "input_tokens": input_tokens,
                "avg_task_input_tokens": round(average["input_tokens"]),
                "output_tokens": int(group["output_tokens"].sum()),
                "avg_task_output_tokens": round(average["output_tokens"]),
            }
        )
    return pd.DataFrame(rows, columns=SUMMARY_COLUMNS)


def summarize(trials: pd.DataFrame) -> str:
    """summary.csv as text, with the count of trials it leaves out."""
    if trials.empty:
        return "No trials found."
    summary = agent_summary(trials)
    if summary.empty:
        return "No task has a valid trial from every agent yet."
    lines = []
    for row in summary.itertuples():
        lines.append(
            f"{row.harness:9} tasks {row.tasks:3} | trials {row.trials:4} | score {row.score:6.1%} | "
            f"cost ${row.cost_usd:.2f} | cache hit {row.cache_hit_rate:.1%}"
        )
        lines.append(
            f"{'':9} per task: avg ${row.avg_task_cost_usd:.2f}, p90 ${row.p90_task_cost_usd:.2f} | "
            f"avg {row.avg_task_input_tokens:,} in, {row.avg_task_output_tokens:,} out"
        )
    left_out = len(trials) - int(summary["trials"].sum())
    if left_out:
        lines.append(
            f"{left_out} trials left out: excluded task, infra, no usage, "
            "or beyond what every agent has finished on that task"
        )
    return "\n".join(lines)


def _text(value: Any) -> str:
    return value if isinstance(value, str) else ""


def consistency_warnings(trials: pd.DataFrame) -> list[str]:
    """Trials without usage logs, with subagent calls, or off model, effort, or version."""
    warnings = []
    if trials.empty:
        return warnings
    owned = trials[owned_mask(trials)]
    for row in owned.itertuples():
        label = f"{row.harness} #{row.attempt} {row.job}"
        if row.usage_missing:
            warnings.append(f"{label}: no model calls in logs; excluded from metrics")
            continue
        if row.subagent_calls:
            warnings.append(f"{label}: subagent calls found ({row.subagent_calls})")
        requested_model = str(row.model).split("/")[-1]
        effort = _text(row.observed_efforts)
        if effort != row.effort:
            warnings.append(f"{label}: effort {effort or UNRECORDED} (requested {row.effort})")
        model = _text(row.observed_models)
        if model and model.split("/")[-1] != requested_model:
            warnings.append(f"{label}: model {model} (requested {requested_model})")
    for harness, group in owned.groupby("harness", sort=True):
        versions = sorted(group["agent_version"].dropna().astype(str).unique())
        if len(versions) > 1:
            warnings.append(f"{harness}: trials ran different versions ({', '.join(versions)})")
    return warnings
