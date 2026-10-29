"""Runs rounds of one task and attempt for all three agents at once, until the quota is exhausted."""

from __future__ import annotations

import asyncio
import json
import random
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from harbor.environments.docker.docker import _sanitize_docker_compose_project_name
from harbor.models.job.config import DatasetConfig
from harbor.models.trial.config import TaskConfig, TrialConfig

from surgent_bench.prebuild import find_build, prebuilt_archive
from surgent_bench.pricing import COST_DIGITS
from surgent_bench.results import STALL_MARKER, Trial, load_trial
from surgent_bench.settings import (
    BENCH_DIR,
    HARNESSES,
    SURGENT_PROVIDER,
    BenchConfig,
    Suite,
    trial_folder,
)

IMPORT_PATHS = {
    "surgent": "surgent_bench.agents.surgent:Surgent",
    "codex": "surgent_bench.agents.codex:CodexBench",
    "opencode": "surgent_bench.agents.opencode:OpenCodeBench",
}
EXIT_LOGIN = 2
EXIT_QUOTA = 3
EXIT_SETUP = 4
EXIT_HARBOR = 5
EXIT_INTERRUPTED = 130
NO_WEB = {"disable_web_search": True}
STRIP_TESTS = "strip_agent_tests"
SETUP_COMMANDS = "setup_commands"
HARBOR_TRIAL = (sys.executable, "-m", "surgent_bench.harbor_cli", "trials", "start", "-c")
# Harbor tees each agent's output to this file in the trial's agent folder.
AGENT_LOGS = {"surgent": "pi.txt", "codex": "codex.txt", "opencode": "opencode.txt"}
POLL_SECONDS = 5
# One record per process: its stat line, then its NUL-separated command line.
LIST_PROCESSES = (
    'for dir in /proc/[0-9]*; do cat "$dir/stat" 2>/dev/null; printf "\\037"; '
    'cat "$dir/cmdline" 2>/dev/null; printf "\\036"; done'
)


@dataclass(frozen=True)
class Round:
    suite: Suite
    task: TaskConfig
    attempt: int

    @property
    def path(self) -> Path:
        name = self.task.get_task_id().get_name().rsplit("/", 1)[-1]
        return Path(self.suite.name, re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("-"))

    @property
    def label(self) -> str:
        return f"{self.path} #{self.attempt}"


def pick_tasks(names: list[str], count: int, seed: int) -> list[str]:
    order = sorted(names)
    random.Random(seed).shuffle(order)
    return order[:count]


def dataset_tasks(suite: Suite) -> dict[str, TaskConfig]:
    dataset = DatasetConfig(name=suite.dataset, ref=suite.ref)
    configs = asyncio.run(dataset.get_task_configs())
    return {config.get_task_id().get_name(): config for config in configs}


def suite_tasks(suite: Suite, seed: int) -> list[TaskConfig]:
    if suite.limit <= 0:
        return []
    tasks = dataset_tasks(suite)
    # Exclude before cutting, so `limit` counts only tasks that run.
    order = [name for name in pick_tasks(list(tasks), len(tasks), seed) if not suite.excludes(name)]
    return [tasks[name] for name in order[suite.offset : suite.offset + suite.limit]]


def plan_rounds(config: BenchConfig) -> list[Round]:
    """One pass over every suite's tasks per attempt, alternating suites within a pass."""
    tasks = [suite_tasks(suite, config.seed) for suite in config.suites]
    rounds = []
    for attempt in range(1, config.max_trials + 1):
        queues = [
            [Round(suite, task, attempt) for task in suite_list]
            for suite, suite_list in zip(config.suites, tasks)
        ]
        while any(queues):
            for queue in queues:
                if queue:
                    rounds.append(queue.pop(0))
    return rounds


def agent_entry(config: BenchConfig, harness: str, current: Round, build: str) -> dict[str, Any]:
    kwargs: dict[str, Any] = {STRIP_TESTS: current.suite.strip_agent_tests}
    commands = current.suite.commands_for(current.task.get_task_id().get_name())
    if commands:
        kwargs[SETUP_COMMANDS] = list(commands)
    env: dict[str, str] = {}
    model = f"openai/{config.model}"
    if harness == "surgent":
        model = f"{SURGENT_PROVIDER}/{config.model}"
        kwargs["thinking"] = config.effort
        kwargs["login_path"] = str(config.auth.surgent)
        kwargs["prebuilt"] = str(prebuilt_archive(build))
    elif harness == "codex":
        kwargs.update(NO_WEB, reasoning_effort=config.effort)
        env["CODEX_AUTH_JSON_PATH"] = str(config.auth.codex)
    else:
        kwargs.update(NO_WEB, variant=config.effort, login_path=str(config.auth.opencode))
    version = config.versions.get(harness)
    if version:
        kwargs["version"] = version
    entry: dict[str, Any] = {
        "import_path": IMPORT_PATHS[harness],
        "model_name": model,
        "kwargs": kwargs,
    }
    if env:
        entry["env"] = env
    if config.agent_hosts:
        entry["extra_allowed_hosts"] = list(config.agent_hosts)
    return entry


def trial_config(config: BenchConfig, current: Round, harness: str, build: str) -> dict[str, Any]:
    data: dict[str, Any] = {
        "task": current.task.model_dump(mode="json", exclude_defaults=True),
        "trial_name": trial_folder(harness, build, current.attempt),
        "trials_dir": str(config.jobs_dir / current.path),
        "agent_timeout_multiplier": current.suite.agent_timeout_multiplier
        or config.agent_timeout_multiplier,
        "agent": agent_entry(config, harness, current, build),
    }
    if config.extra_instruction:
        data["extra_instructions"] = [config.extra_instruction]
    return data


def trial_dir(config: BenchConfig, current: Round, harness: str, build: str) -> Path:
    return config.jobs_dir / current.path / trial_folder(harness, build, current.attempt)


def round_results(config: BenchConfig, current: Round, build: str) -> dict[str, Trial]:
    results: dict[str, Trial] = {}
    for harness in HARNESSES:
        result_path = trial_dir(config, current, harness, build) / "result.json"
        trial = load_trial(result_path, current.attempt)
        if trial is not None:
            results[harness] = trial
    return results


def _setup(
    trial: TrialConfig, same_suite: bool, same_task: bool, same_agent: bool
) -> dict[str, Any]:
    """What must match between two recorded trials, by how much they share."""
    setup: dict[str, Any] = {"extra_instructions": trial.extra_instructions}
    if same_suite:
        setup["agent_timeout_multiplier"] = trial.agent_timeout_multiplier
    if same_agent:
        agent = trial.agent.model_dump(mode="json")
        if not same_suite:
            agent["kwargs"].pop(STRIP_TESTS, None)
        if not same_task:
            agent["kwargs"].pop(SETUP_COMMANDS, None)
        setup["agent"] = agent
    return setup


def check_setup(config: BenchConfig, current: Round, build: str) -> None:
    """Exit when this round's setup differs from a recorded trial of the same build."""
    folders = {
        trial_folder(harness, build, attempt): harness
        for harness in HARNESSES
        for attempt in range(1, config.max_trials + 1)
    }
    recorded = [
        (path, harness, TrialConfig.model_validate_json(path.read_text()))
        for folder, harness in folders.items()
        for path in sorted(config.jobs_dir.glob(f"*/*/{folder}/config.json"))
    ]
    for harness in HARNESSES:
        planned = TrialConfig.model_validate(trial_config(config, current, harness, build))
        for path, recorded_harness, trial in recorded:
            same_suite = path.parts[-4] == current.suite.name
            same_task = same_suite and path.parts[-3] == current.path.name
            same_agent = recorded_harness == harness
            expected = _setup(planned, same_suite, same_task, same_agent)
            found = _setup(trial, same_suite, same_task, same_agent)
            changed = [key for key in expected if expected[key] != found[key]]
            if changed:
                folder = current.path / trial_folder(harness, build, current.attempt)
                other = path.parent.relative_to(config.jobs_dir)
                log(f"{folder}: setup differs from {other} in {', '.join(changed)}")
                log("Restore those settings, or set a new run.jobs_dir for a separate experiment")
                raise SystemExit(EXIT_SETUP)


def scrub_logins(trial_dir: Path) -> None:
    for path in trial_dir.rglob("auth.json"):
        path.unlink(missing_ok=True)


def log(message: str) -> None:
    print(f"[{datetime.now(UTC):%Y-%m-%d %H:%M:%S}Z] {message}", flush=True)


def docker(*args: str) -> str:
    try:
        done = subprocess.run(
            ["docker", *args], capture_output=True, encoding="utf-8", errors="replace", timeout=120
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return done.stdout.strip()


def agent_processes(listing: str, log_path: str) -> list[int]:
    """The process groups writing `log_path`, with every descendant."""
    parents: dict[int, int] = {}
    groups: dict[int, int] = {}
    writers: set[int] = set()
    for record in listing.split("\x1e"):
        stat, _, cmdline = record.partition("\x1f")
        fields = stat.rpartition(")")[2].split()
        if len(fields) < 3:
            continue
        pid = int(stat.split(" ", 1)[0])
        parents[pid], groups[pid] = int(fields[1]), int(fields[2])
        if log_path in cmdline:
            writers.add(groups[pid])
    found = {pid for pid, group in groups.items() if group in writers}
    # Children in their own session, like opencode's rg, would outlive the group.
    while True:
        children = {pid for pid, parent in parents.items() if parent in found} - found
        if not children:
            return sorted(found)
        found |= children


def stop_agent(trial_name: str, harness: str) -> bool | None:
    """Kill the agent's processes: False when it already exited, None when unreadable."""
    containers = docker(
        "ps", "-q",
        "--filter", f"label=com.docker.compose.project={_sanitize_docker_compose_project_name(f'{trial_name}__env')}",
        "--filter", "label=com.docker.compose.service=main",
    ).split()
    listing = containers and docker("exec", "-u", "0", containers[0], "sh", "-c", LIST_PROCESSES)
    if not listing:
        return None
    victims = agent_processes(listing, f"/logs/agent/{AGENT_LOGS[harness]}")
    if victims:
        pids = map(str, victims)
        docker("exec", "-u", "0", containers[0], "sh", "-c", 'kill -9 "$@"', "sh", *pids)
    return bool(victims)


def remove_containers(trial_name: str) -> None:
    """Remove a trial's containers and networks, which Harbor names after it."""
    prefix = _sanitize_docker_compose_project_name(f"{trial_name}__")
    rows = docker("ps", "-a", "--format", '{{.ID}} {{.Label "com.docker.compose.project"}}')
    containers = [
        row.split()[0] for row in rows.splitlines() if row.partition(" ")[2].startswith(prefix)
    ]
    if containers:
        docker("rm", "-f", *containers)
    names = docker("network", "ls", "--format", "{{.Name}}").split()
    networks = [name for name in names if name.startswith(prefix)]
    if networks:
        docker("network", "rm", *networks)


def check_stall(config: BenchConfig, current: Round, harness: str, data: dict[str, Any]) -> bool:
    """Stop an agent silent for `run.stall_minutes`; True once there is nothing left to watch."""
    folder = Path(data["trials_dir"]) / data["trial_name"]
    try:
        silent = time.time() - (folder / "agent" / AGENT_LOGS[harness]).stat().st_mtime
    except FileNotFoundError:
        # The agent hasn't started.
        return False
    if silent < config.stall_minutes * 60:
        return False
    stopped = stop_agent(data["trial_name"], harness)
    if stopped is None:
        return False
    if stopped:
        minutes = f"{config.stall_minutes:g}"
        (folder / STALL_MARKER).write_text(f"No agent output for {minutes} minutes\n")
        log(f"{current.label}: {harness} gave no output for {minutes} minutes; stopped it")
    return True


def stop_trials(
    running: dict[str, subprocess.Popen[bytes]], configs: dict[str, dict[str, Any]]
) -> None:
    """Let Harbor remove each trial's containers; a second Ctrl+C removes them here."""
    log(f"Stopping {len(running)} trials; Harbor is removing their containers (Ctrl+C to force)")
    for process in running.values():
        process.send_signal(signal.SIGINT)
    try:
        for process in running.values():
            process.wait()
    except KeyboardInterrupt:
        # Quick, and stopping it halfway would leave containers behind.
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        log("Forcing: killing the trials and removing their containers")
        for harness, process in running.items():
            process.kill()
            process.wait()
            remove_containers(configs[harness]["trial_name"])


def run_trials(
    config: BenchConfig, current: Round, configs: dict[str, dict[str, Any]]
) -> dict[str, int]:
    """Harbor's exit code per harness, running `run.n_concurrent` trials at a time."""
    codes: dict[str, int] = {}
    running: dict[str, subprocess.Popen[bytes]] = {}
    watched = {harness for harness in configs if config.stall_minutes > 0}
    queue = list(configs)
    with tempfile.TemporaryDirectory(prefix="bench-trial-") as temp_dir:
        try:
            while queue or running:
                while queue and len(running) < max(config.n_concurrent, 1):
                    harness = queue.pop(0)
                    config_path = Path(temp_dir) / f"{harness}.json"
                    config_path.write_text(json.dumps(configs[harness]))
                    # Its own session keeps Ctrl+C from reaching Harbor mid-cleanup.
                    running[harness] = subprocess.Popen(
                        [*HARBOR_TRIAL, str(config_path)],
                        cwd=BENCH_DIR,
                        stdin=subprocess.DEVNULL,
                        start_new_session=True,
                    )
                time.sleep(POLL_SECONDS)
                for harness, process in list(running.items()):
                    if process.poll() is not None:
                        codes[harness] = process.returncode
                        del running[harness]
                    elif harness in watched and check_stall(
                        config, current, harness, configs[harness]
                    ):
                        watched.discard(harness)
        except KeyboardInterrupt:
            stop_trials(running, configs)
            raise
    return codes


def outcome(trial: Trial) -> str:
    parts = ["no reward" if trial.reward is None else f"reward {trial.reward:g}"]
    if trial.cost_usd is not None:
        parts.append(f"${trial.cost_usd:.{COST_DIGITS}f}")
    if trial.exception_type:
        parts.append(trial.exception_type)
    if trial.infra:
        parts.append(f"{trial.infra} failure")
    return ", ".join(parts)


def run_round(config: BenchConfig, current: Round, build: str) -> None:
    for retry in range(config.max_retries + 1):
        results = round_results(config, current, build)
        pending = [
            harness
            for harness in HARNESSES
            if harness not in results or results[harness].infra is not None
        ]
        if not pending:
            return
        names = ", ".join(pending)
        if retry == 0 and results:
            log(f"{current.label}: resuming for {names}")
        trial_dirs = {harness: trial_dir(config, current, harness, build) for harness in pending}
        for path in trial_dirs.values():
            if path.exists():
                shutil.rmtree(path)
        log(f"{current.label}: running {names}")
        configs = {harness: trial_config(config, current, harness, build) for harness in pending}
        codes = run_trials(config, current, configs)
        for path in trial_dirs.values():
            if path.is_dir():
                scrub_logins(path)
        results = round_results(config, current, build)
        for harness in pending:
            code = codes[harness]
            if harness in results:
                log(f"{current.label}: {harness} {outcome(results[harness])}")
            elif code != 0:
                other = trial_dirs[harness].relative_to(config.jobs_dir)
                log(f"{other}: harbor exited with code {code}; see its output above")
                raise SystemExit(EXIT_HARBOR)
        failures = {results[harness].infra for harness in pending if harness in results}
        if "auth" in failures:
            log(f"{current.label}: login rejected; log in again and restart")
            raise SystemExit(EXIT_LOGIN)
        if "quota" in failures:
            log(f"{current.label}: hit the usage limit; restart after the quota resets")
            raise SystemExit(EXIT_QUOTA)
    failed = [
        harness
        for harness, trial in round_results(config, current, build).items()
        if trial.infra is not None
    ]
    if failed:
        log(f"{current.label}: giving up on {', '.join(failed)} after retries")


def run_all(config: BenchConfig, limit: int | None = None) -> None:
    # Ctrl+C or `kill <pid>` lets trials clean up, even when started in the background.
    for stop in (signal.SIGINT, signal.SIGTERM):
        signal.signal(stop, signal.default_int_handler)
    try:
        run_rounds(config, limit)
    except KeyboardInterrupt:
        log("Stopped; unfinished trials rerun on restart")
        raise SystemExit(EXIT_INTERRUPTED) from None


def run_rounds(config: BenchConfig, limit: int | None) -> None:
    rounds = plan_rounds(config)
    pass_size = len(rounds) // config.max_trials
    if limit is not None:
        rounds = rounds[:limit]
    log(f"{len(rounds)} rounds planned; each of the {config.max_trials} passes covers {pass_size} tasks")
    build = ""
    if rounds:
        build = find_build() or ""
        if not build:
            log("surgent needs exactly one prebuilt build; run `surgent-bench preflight`")
            raise SystemExit(EXIT_SETUP)
        log(f"surgent build {build}: its trials go in <suite>/<task>/{trial_folder('surgent', build)}[-N]")
    for position, current in enumerate(rounds, start=1):
        # Preflight removes every other build, so a missing archive means a new one.
        if not prebuilt_archive(build).is_file():
            log("surgent's build changed since the run started; restart the driver")
            raise SystemExit(EXIT_SETUP)
        check_setup(config, current, build)
        log(f"Round {position}/{len(rounds)}: {current.label}")
        run_round(config, current, build)
    log("All rounds finished")
