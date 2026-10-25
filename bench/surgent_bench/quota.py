"""Quota readings from codex rollout logs, and login health."""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from surgent_bench.settings import SURGENT_PROVIDER, AuthPaths

ROLLOUT_GLOB = "*/*/*/**/sessions/**/rollout-*.jsonl"
RECENT_ROLLOUTS = 12
WEEK_MINUTES = 7 * 24 * 60


@dataclass(frozen=True)
class Window:
    used_percent: float
    window_minutes: int | None
    resets_at: datetime | None


@dataclass(frozen=True)
class RateLimits:
    observed_at: datetime
    short: Window | None
    weekly: Window | None
    round_name: str


def _window(raw: Any) -> Window | None:
    if not isinstance(raw, dict) or not isinstance(raw.get("used_percent"), (int, float)):
        return None
    resets = raw.get("resets_at")
    return Window(
        used_percent=float(raw["used_percent"]),
        window_minutes=raw.get("window_minutes"),
        resets_at=datetime.fromtimestamp(resets, tz=UTC) if isinstance(resets, (int, float)) else None,
    )


def _snapshots(path: Path, round_name: str) -> list[RateLimits]:
    snapshots = []
    with path.open(errors="replace") as handle:
        for line in handle:
            if '"rate_limits"' not in line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            payload = entry.get("payload") or {}
            limits = payload.get("rate_limits") if payload.get("type") == "token_count" else None
            stamp = entry.get("timestamp")
            if not isinstance(limits, dict) or not isinstance(stamp, str):
                continue
            windows = [_window(limits.get(slot)) for slot in ("primary", "secondary")]
            weekly = next((window for window in windows if _is_weekly(window)), None)
            snapshots.append(
                RateLimits(
                    observed_at=datetime.fromisoformat(stamp.replace("Z", "+00:00")),
                    short=next((window for window in windows if window and window is not weekly), None),
                    weekly=weekly,
                    round_name=round_name,
                )
            )
    return snapshots


# Slots do not name windows: a weekly-only plan reports it as `primary`.
def _is_weekly(window: Window | None) -> bool:
    return window is not None and (window.window_minutes or 0) >= WEEK_MINUTES


def _round_name(trial_path: Path) -> str:
    """`<suite>/<task> #<attempt>` from a codex trial folder, `codex` or `codex-<attempt>`."""
    suite, task, folder = trial_path.parts[:3]
    head, _, suffix = folder.rpartition("-")
    attempt = suffix if head and suffix.isdigit() else "1"
    return f"{suite}/{task} #{attempt}"


def rate_limit_history(jobs_dir: Path, recent: int | None = None) -> list[RateLimits]:
    """Snapshots from codex rollouts, oldest first; `recent` limits files read."""
    paths = sorted(jobs_dir.glob(ROLLOUT_GLOB), key=lambda path: path.stat().st_mtime)
    if recent is not None:
        paths = paths[-recent:]
    snapshots = []
    for path in paths:
        snapshots.extend(_snapshots(path, _round_name(path.relative_to(jobs_dir))))
    return sorted(snapshots, key=lambda snapshot: snapshot.observed_at)


def latest_rate_limits(jobs_dir: Path) -> RateLimits | None:
    history = rate_limit_history(jobs_dir, RECENT_ROLLOUTS)
    return history[-1] if history else None


def round_usage(jobs_dir: Path) -> list[tuple[str, float]]:
    """Weekly-window percent consumed by each round (last snapshot deltas)."""
    last_by_round: dict[str, RateLimits] = {}
    for snapshot in rate_limit_history(jobs_dir):
        if snapshot.weekly is not None:
            last_by_round[snapshot.round_name] = snapshot
    ordered = sorted(last_by_round.values(), key=lambda snapshot: snapshot.observed_at)
    deltas = []
    for previous, current in zip(ordered, ordered[1:]):
        delta = current.weekly.used_percent - previous.weekly.used_percent
        # A negative delta means the weekly window reset between rounds.
        if delta >= 0:
            deltas.append((current.round_name, delta))
    return deltas


def _jwt_expiry(token: str) -> datetime | None:
    try:
        segment = token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4)))
    except (IndexError, ValueError):
        return None
    expiry = claims.get("exp")
    return datetime.fromtimestamp(expiry, tz=UTC) if isinstance(expiry, (int, float)) else None


def _read_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def login_expiries(auth: AuthPaths) -> dict[str, datetime | None]:
    """Access-token expiry per harness login; None when missing or unreadable."""
    codex_tokens = _read_json(auth.codex).get("tokens") or {}
    codex_access = codex_tokens.get("access_token")
    surgent_login = _surgent_login(auth)
    opencode_login = _read_json(auth.opencode).get("openai") or {}
    return {
        "codex": _jwt_expiry(codex_access) if isinstance(codex_access, str) else None,
        "surgent": _millis(surgent_login.get("expires")),
        "opencode": _millis(opencode_login.get("expires")),
    }


def _millis(value: Any) -> datetime | None:
    if not isinstance(value, (int, float)):
        return None
    return datetime.fromtimestamp(value / 1000, tz=UTC)


def _surgent_login(auth: AuthPaths) -> dict[str, Any]:
    return _read_json(auth.surgent).get(SURGENT_PROVIDER) or {}
