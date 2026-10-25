"""Helpers shared by the benchmark's Harbor agent adapters."""

from __future__ import annotations

import json
import os
import shlex
import time
from pathlib import Path, PurePosixPath
from typing import override

from harbor.agents.installed.base import BaseInstalledAgent
from harbor.agents.options import InstalledAgentOptions
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext
from harbor.models.task.config import NetworkMode, NetworkPolicy
from pydantic import Field

from surgent_bench.pricing import COST_DIGITS

PUBLIC = NetworkPolicy(network_mode=NetworkMode.PUBLIC)
GIT = "git -c safe.directory='*' -c core.quotePath=false"
# Outlasts any pi auth write, so proper-lockfile never treats the lock as stale.
LOCK_WAIT_SEC = 10.0
# Rust is left out: its integration tests compile as separate crates.
TEST_FILE = r"_test\.go$|(^|/)test_[^/]*\.py$|_test\.py$|\.(test|tests|spec)\.[cm]?[jt]sx?$"


class BenchOptions(InstalledAgentOptions):
    strip_agent_tests: bool = Field(
        default=False,
        description="Move test files the agent created into its logs before grading.",
    )
    setup_commands: list[str] = Field(
        default_factory=list,
        description="Shell commands run as root, with network, before the agent installs.",
    )


class BenchAgent(BaseInstalledAgent):
    """Setup runs online, then the task's network policy returns for the agent and grader."""

    options: BenchOptions

    @override
    async def run(
        self, instruction: str, environment: BaseEnvironment, context: AgentContext
    ) -> None:
        if not self.options.strip_agent_tests:
            await super().run(instruction, environment, context)
            return
        probe = await self.exec_as_root(environment, command=f"{GIT} rev-parse HEAD 2>/dev/null || true")
        start = (probe.stdout or "").strip()
        try:
            await super().run(instruction, environment, context)
        finally:
            if start:
                await self._strip_tests(environment, start)

    async def _strip_tests(self, environment: BaseEnvironment, start: str) -> None:
        """Move created test files aside: graders delete those named like hidden tests."""
        target = shlex.quote(str(self.environment_logs_dir / "stripped-tests"))
        command = (
            f'cd "$({GIT} rev-parse --show-toplevel)" && '
            f"{{ {GIT} diff --name-only --diff-filter=A {shlex.quote(start)}; "
            f"{GIT} ls-files --others --exclude-standard; }} | sort -u | "
            f"{{ grep -E {shlex.quote(TEST_FILE)} || true; }} | "
            'while IFS= read -r path; do '
            '[ -f "$path" ] || continue; '
            f'mkdir -p {target}/"$(dirname "$path")" && mv "$path" {target}/"$path" && echo "$path"; '
            "done"
        )
        try:
            result = await self.exec_as_root(environment, command=command, timeout_sec=120)
        except Exception:
            # Raising would hide the agent's own outcome, such as a timeout.
            self.logger.warning("Could not set the agent's tests aside", exc_info=True)
            return
        stripped = (result.stdout or "").splitlines()
        if stripped:
            self.logger.info(f"Set aside agent tests before grading: {', '.join(stripped)}")

    @override
    async def setup(self, environment: BaseEnvironment) -> None:
        baseline = environment.network_policy
        if baseline == PUBLIC:
            await self._install(environment)
            return
        await environment.set_network_policy(PUBLIC)
        try:
            await self._install(environment)
        finally:
            await environment.set_network_policy(baseline)

    async def _install(self, environment: BaseEnvironment) -> None:
        for command in self.options.setup_commands:
            await self.exec_as_root(environment, command=command)
        await super().setup(environment)

    @override
    def populate_context_post_run(self, context: AgentContext) -> None:
        super().populate_context_post_run(context)
        if context.cost_usd is not None:
            context.cost_usd = round(context.cost_usd, COST_DIGITS)
        # One model per run; left as None, Harbor refills it from the trajectory.
        context.model_usage = {}


def read_login(path: Path, provider: str) -> str:
    """auth.json content with only `provider`'s login; errors never show values."""
    try:
        logins = json.loads(path.read_text())
    except FileNotFoundError as error:
        raise ValueError(f"Login file not found: {path}") from error
    if not isinstance(logins, dict) or provider not in logins:
        found = ", ".join(sorted(logins)) if isinstance(logins, dict) else "none"
        raise ValueError(f"{path} has no '{provider}' login (found: {found or 'none'})")
    return json.dumps({provider: logins[provider]})


def store_login(path: Path, provider: str, login: dict) -> bool:
    """Save a refreshed login to the host unless the stored one expires later.

    Takes pi's `proper-lockfile` lock so a host pi session cannot interleave.
    """
    lock = path.with_name(f"{path.name}.lock")
    deadline = time.monotonic() + LOCK_WAIT_SEC
    while True:
        try:
            lock.mkdir()
            break
        except FileExistsError:
            if time.monotonic() > deadline:
                raise TimeoutError(f"{lock} stayed locked") from None
            time.sleep(0.2)
    try:
        logins = json.loads(path.read_text())
        if login.get("expires", 0) <= (logins.get(provider) or {}).get("expires", 0):
            return False
        logins[provider] = login
        staging = path.with_name(f"{path.name}.bench")
        descriptor = os.open(staging, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "w") as handle:
            json.dump(logins, handle, indent=2)
        os.replace(staging, path)
        return True
    finally:
        lock.rmdir()


async def place_home_file(
    agent: BaseInstalledAgent,
    environment: BaseEnvironment,
    content: str,
    home_path: str,
) -> None:
    """Upload `content` privately to `$HOME/<home_path>` of the agent user."""
    target = PurePosixPath(home_path)
    staging = f"/tmp/bench-{target.name}"
    await agent._upload_config_text(
        environment,
        content=content,
        remote_path=staging,
        filename=target.name,
    )
    await agent.exec_as_agent(
        environment,
        command=(
            f'mkdir -p "$HOME/{target.parent}" && '
            f'mv {shlex.quote(staging)} "$HOME/{target}"'
        ),
    )
