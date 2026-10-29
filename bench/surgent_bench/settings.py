"""Benchmark configuration and well-known paths."""

from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

BENCH_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = Path(os.environ.get("SURGENT_REPO", BENCH_DIR.parent)).resolve()
DEFAULT_CONFIG = BENCH_DIR / "config.toml"
HARNESSES = ("surgent", "codex", "opencode")
SURGENT_PREFIX = "surgent-"
# pi's legacy Codex provider calls chatgpt.com, the backend codex and opencode use.
SURGENT_PROVIDER = "openai-codex"


def trial_folder(harness: str, build: str, attempt: int = 1) -> str:
    """`codex`, `codex-2`, ...: Harbor names each trial's containers after its folder."""
    name = f"{SURGENT_PREFIX}{build}" if harness == "surgent" else harness
    if attempt > 1:
        return f"{name}-{attempt}"
    return name


@dataclass(frozen=True)
class Suite:
    name: str
    dataset: str
    ref: str | None = None
    # A window of the seeded task order, so machines can split a suite.
    offset: int = 0
    limit: int = 0
    agent_timeout_multiplier: float | None = None
    # Task names without their dataset org, as in `setup_commands`.
    exclude: tuple[str, ...] = ()
    strip_agent_tests: bool = True
    setup_commands: tuple[tuple[str, tuple[str, ...]], ...] = ()

    def excludes(self, task: str) -> bool:
        return task.rsplit("/", 1)[-1] in self.exclude

    def commands_for(self, task: str) -> tuple[str, ...]:
        return dict(self.setup_commands).get(task.rsplit("/", 1)[-1], ())


@dataclass(frozen=True)
class AuthPaths:
    codex: Path
    surgent: Path
    opencode: Path


@dataclass(frozen=True)
class BenchConfig:
    model: str
    effort: str
    versions: dict[str, str]
    auth: AuthPaths
    jobs_dir: Path
    agent_timeout_multiplier: float
    # Minutes without agent output before the driver stops the agent; 0 turns it off.
    stall_minutes: float
    n_concurrent: int
    agent_hosts: list[str]
    seed: int
    # Attempts per agent per task, all graded.
    max_trials: int
    max_retries: int
    extra_instruction: str
    suites: list[Suite]


def resolve_path(value: str) -> Path:
    path = Path(value).expanduser()
    return path if path.is_absolute() else (BENCH_DIR / path).resolve()


def _section(data: dict[str, Any], name: str) -> dict[str, Any]:
    section = data.get(name, {})
    if not isinstance(section, dict):
        raise ValueError(f"[{name}] must be a table")
    return section


def _suite(entry: dict[str, Any]) -> Suite:
    if not entry.get("dataset"):
        raise ValueError(f"Suite {entry.get('name')!r} needs a dataset")
    offset = int(entry.get("offset", 0))
    limit = int(entry.get("limit", 0))
    if offset < 0 or limit < 0:
        raise ValueError(f"Suite {entry['name']!r} needs a non-negative offset and limit")
    return Suite(
        name=entry["name"],
        dataset=entry["dataset"],
        ref=entry.get("ref") or None,
        offset=offset,
        limit=limit,
        agent_timeout_multiplier=entry.get("agent_timeout_multiplier"),
        exclude=tuple(entry.get("exclude", [])),
        strip_agent_tests=bool(entry.get("strip_agent_tests", True)),
        setup_commands=tuple(
            (task, tuple(commands))
            for task, commands in _section(entry, "setup_commands").items()
        ),
    )


def load_config(path: Path = DEFAULT_CONFIG) -> BenchConfig:
    data = tomllib.loads(path.read_text())
    model = _section(data, "model")
    agents = _section(data, "agents")
    auth = _section(data, "auth")
    run = _section(data, "run")
    max_trials = int(run.get("max_trials", 3))
    if max_trials < 1:
        raise ValueError("run.max_trials must be at least 1")
    return BenchConfig(
        model=model["name"],
        effort=model["effort"],
        versions={
            harness: str(agents.get(f"{harness}_version", ""))
            for harness in HARNESSES
            if harness != "surgent"
        },
        auth=AuthPaths(
            codex=resolve_path(auth.get("codex", "~/.codex/auth.json")),
            surgent=resolve_path(auth.get("surgent", "~/.pi/agent/auth.json")),
            opencode=resolve_path(auth.get("opencode", "~/.local/share/opencode/auth.json")),
        ),
        jobs_dir=resolve_path(run.get("jobs_dir", "jobs")),
        agent_timeout_multiplier=float(run.get("agent_timeout_multiplier", 1.0)),
        stall_minutes=float(run.get("stall_minutes", 20)),
        n_concurrent=int(run.get("n_concurrent", 3)),
        agent_hosts=list(run.get("agent_hosts", [])),
        seed=int(run.get("seed", 7)),
        max_trials=max_trials,
        max_retries=int(run.get("max_retries", 2)),
        extra_instruction=str(run.get("extra_instruction", "")),
        suites=[_suite(entry) for entry in data.get("suites", [])],
    )
