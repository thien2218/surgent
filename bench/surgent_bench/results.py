"""Discover Harbor trial results and classify why trials failed."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from surgent_bench.settings import HARNESSES, TRIALS, trial_folder
from surgent_bench.usage import harness_calls

# Failures the agent does not own: rerun by the driver, left out of metrics.
QUOTA_TYPES = {"ApiRateLimitError", "ApiUsageLimitError", "HostedQuotaExceededError"}
AUTH_TYPES = {
    "AgentAuthenticationError",
    "ApiKeyRejectedError",
    "AuthenticationError",
    "NotAuthenticatedError",
    "OAuthCallbackError",
    "StaleAccessTokenError",
}
SANDBOX_TYPES = {
    "AddTestsDirError",
    "AgentSetupTimeoutError",
    "ApiConnectionClosedError",
    "ApiConnectionError",
    "ApiInternalServerError",
    "ApiOverloadedError",
    "ApiResponseStalledError",
    "DownloadVerifierDirError",
    "EnvironmentStartTimeoutError",
    "HealthcheckError",
    "NetworkConnectionError",
    "RewardFileEmptyError",
    "RewardFileNotFoundError",
    "SandboxBuildFailedError",
    "SandboxLikelyOutOfMemoryError",
    "VerifierOutputParseError",
    "VerifierTimeoutError",
}
# Trials still running when the driver stops.
INTERRUPTED_TYPES = {"CancelledError"}
# The driver leaves this file in a trial whose agent it stopped for giving no output.
STALL_MARKER = "stalled.txt"
STALLED = "AgentStalledError"
USAGE_LIMIT = re.compile(r"usage[ _]limit", re.IGNORECASE)
# Matched only against the error that ended the run: agents retry transient ones.
QUOTA_PATTERN = re.compile(
    r"rate[ _]limit|too many requests|\b429\b|quota exceeded", re.IGNORECASE
)
AUTH_PATTERN = re.compile(
    r"\b401\b|unauthorized|refresh_token_reused|invalid_grant|token (?:has )?expired"
    r"|sign in again|not logged in|no '[\w-]+' login|login file not found",
    re.IGNORECASE,
)
# Error events only: tool output may quote repo text about rate limits.
ERROR_EVENT = re.compile(
    r'"(?:type|stopReason)"\s*:\s*"(?:error|turn\.failed)"|"(?:error|errorMessage)"\s*:\s*[{"]'
)
OUTPUT_TAIL = 20000
FINAL_LINES = 3
FINAL_TAIL_BYTES = 8 * 1024 * 1024


@dataclass
class Trial:
    trial_dir: Path
    job_name: str
    harness: str
    attempt: int
    task: str
    model: str | None
    kwargs: dict[str, Any]
    reward: float | None
    exception_type: str | None
    exception_message: str
    started_at: datetime | None
    finished_at: datetime | None
    agent_started_at: datetime | None
    agent_finished_at: datetime | None
    infra: str | None = None
    agent_version: str | None = None
    cost_usd: float | None = None

    @property
    def agent_dir(self) -> Path:
        return self.trial_dir / "agent"

    @property
    def completed(self) -> bool:
        return self.infra is None and self.exception_type is None

    @property
    def passed(self) -> bool:
        return self.infra is None and self.reward is not None and self.reward >= 1.0


def _time(value: Any) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def _reward(verifier: Any) -> float | None:
    if not isinstance(verifier, dict):
        return None
    rewards = verifier.get("rewards")
    if not isinstance(rewards, dict) or not rewards:
        return None
    value = rewards.get("reward", next(iter(rewards.values())))
    return float(value) if isinstance(value, (int, float)) else None


def _harness(result: dict[str, Any]) -> str | None:
    name = str((result.get("agent_info") or {}).get("name") or "")
    if name in HARNESSES:
        return name
    agent = (result.get("config") or {}).get("agent") or {}
    source = f"{agent.get('import_path') or ''} {agent.get('name') or ''}".lower()
    for harness in HARNESSES:
        if harness in source:
            return harness
    return None


def _exception(info: Any) -> tuple[str | None, str]:
    if not isinstance(info, dict):
        return None, ""
    return info.get("exception_type"), str(info.get("exception_message") or "")


def _error_events(agent_dir: Path) -> str:
    """Error-shaped lines from the tail of each agent stdout capture."""
    lines = []
    for path in sorted(agent_dir.glob("*.txt")):
        try:
            text = path.read_text(errors="replace")
        except OSError:
            continue
        lines.extend(line for line in text[-OUTPUT_TAIL:].splitlines() if ERROR_EVENT.search(line))
    return "\n".join(lines)


def _final_lines(path: Path) -> list[str]:
    try:
        with path.open("rb") as handle:
            size = handle.seek(0, os.SEEK_END)
            handle.seek(max(size - FINAL_TAIL_BYTES, 0))
            lines = handle.read().decode(errors="replace").splitlines()
    except OSError:
        return []
    if size > FINAL_TAIL_BYTES:
        lines = lines[1:]  # cut mid-line
    return [line for line in lines if line.strip()][-FINAL_LINES:]


def _error_text(line: str) -> str:
    """What a closing output line says went wrong with the run itself."""
    try:
        event = json.loads(line)
    except json.JSONDecodeError:
        # Plain text in JSON-mode output comes from the CLI, not the model.
        return line
    if not isinstance(event, dict):
        return ""
    if event.get("type") in {"error", "turn.failed"}:
        return line
    messages = event.get("messages")
    closing = [event.get("message"), *(messages[-1:] if isinstance(messages, list) else [])]
    errors = [
        str(message.get("errorMessage") or "")
        for message in closing
        if isinstance(message, dict) and message.get("stopReason") == "error"
    ]
    errors.extend(str(event[key]) for key in ("errorMessage", "finalError") if event.get(key))
    return "\n".join(errors)


def _run_errors(agent_dir: Path) -> str:
    """The error each output capture ends on; errors the agent retried past are ignored."""
    texts = []
    for path in sorted(agent_dir.glob("*.txt")):
        for line in reversed(_final_lines(path)):
            text = _error_text(line)
            if not text:
                break
            texts.append(text)
    return "\n".join(texts)


def classify(trial: Trial) -> str | None:
    """Return 'quota', 'auth', 'sandbox', 'interrupted', 'startup', or None when the agent owns the outcome."""
    failure = trial.exception_type
    if failure in QUOTA_TYPES:
        return "quota"
    if failure in AUTH_TYPES:
        return "auth"
    if failure in SANDBOX_TYPES:
        return "sandbox"
    if failure in INTERRUPTED_TYPES:
        return "interrupted"
    if trial.passed:
        return None
    if trial.agent_started_at is None:
        return "auth" if AUTH_PATTERN.search(trial.exception_message) else "sandbox"
    # Some agents exit cleanly or retry until timeout after hitting the cap.
    if USAGE_LIMIT.search(f"{trial.exception_message}\n{_error_events(trial.agent_dir)}"):
        return "quota"
    evidence = _run_errors(trial.agent_dir)
    crashed = failure not in (None, "AgentTimeoutError", STALLED)
    if crashed:
        evidence = f"{trial.exception_message}\n{evidence}"
    if QUOTA_PATTERN.search(evidence):
        return "quota"
    if AUTH_PATTERN.search(evidence):
        return "auth"
    # Ended before calling the model, so the trial says nothing about the agent.
    if failure and not any(call.is_main for call in harness_calls(trial.harness, trial.agent_dir)):
        return "startup"
    return None


def load_trial(result_path: Path, attempt: int) -> Trial | None:
    try:
        result = json.loads(result_path.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(result, dict) or "trial_name" not in result:
        return None
    harness = _harness(result)
    if harness is None:
        return None
    agent = (result.get("config") or {}).get("agent") or {}
    exception_type, exception_message = _exception(result.get("exception_info"))
    stall = result_path.parent / STALL_MARKER
    if stall.is_file():
        exception_type, exception_message = STALLED, stall.read_text().strip()
    execution = result.get("agent_execution") or {}
    trial = Trial(
        trial_dir=result_path.parent,
        job_name="/".join(result_path.parent.parent.parts[-2:]),
        harness=harness,
        attempt=attempt,
        task=str(result.get("task_name")),
        model=(((result.get("agent_info") or {}).get("model_info")) or {}).get("name")
        or agent.get("model_name"),
        kwargs=dict(agent.get("kwargs") or {}),
        reward=_reward(result.get("verifier_result")),
        exception_type=exception_type,
        exception_message=exception_message,
        started_at=_time(result.get("started_at")),
        finished_at=_time(result.get("finished_at")),
        agent_started_at=_time(execution.get("started_at")),
        agent_finished_at=_time(execution.get("finished_at")),
        agent_version=(result.get("agent_info") or {}).get("version") or None,
        cost_usd=(result.get("agent_result") or {}).get("cost_usd"),
    )
    trial.infra = classify(trial)
    return trial


def find_trials(jobs_dir: Path, build: str) -> list[Trial]:
    """Codex and opencode trials, and surgent's from one build."""
    paths = [
        (path, attempt)
        for harness in HARNESSES
        for attempt in range(1, TRIALS + 1)
        for path in jobs_dir.glob(f"*/*/{trial_folder(harness, build, attempt)}/result.json")
    ]
    trials = []
    for result_path, attempt in sorted(paths):
        trial = load_trial(result_path, attempt)
        if trial is not None:
            trials.append(trial)
    return trials
