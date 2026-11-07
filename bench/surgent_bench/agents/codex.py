"""Harbor's codex agent with subagents disabled, on codex's own Sign in with ChatGPT login."""

from __future__ import annotations

from pathlib import Path, PurePosixPath
from typing import Any, override

from harbor.agents.installed.codex import Codex, CodexOptions
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext
from pydantic import Field

from surgent_bench.agents.common import (
    BenchAgent,
    BenchOptions,
    download_json,
    store_codex_login,
)
from surgent_bench.settings import BENCH_DIR

DEFAULT_LOGIN = BENCH_DIR / ".auth" / "codex" / "auth.json"
NO_SUBAGENTS = {
    "agents": {"enabled": False},
    "features": {"multi_agent": False, "multi_agent_v2": False},
}
HARBOR_LOGIN = Codex._REMOTE_CODEX_SECRETS_DIR / "auth.json"
LOGIN_DIR = PurePosixPath("/tmp/codex-bench")
LOGIN_FILE = LOGIN_DIR / "auth.json"


class CodexBenchOptions(BenchOptions, CodexOptions):
    login_path: str | None = Field(
        default=None, description="Host codex auth.json holding the Sign in with ChatGPT login."
    )


class CodexBench(BenchAgent, Codex):
    """Same name as Harbor's codex so results group under `codex`."""

    options_model = CodexBenchOptions
    options: CodexBenchOptions

    @override
    def _build_effective_config(self, openai_base_url: str | None = None) -> dict[str, Any]:
        config = super()._build_effective_config(openai_base_url)
        for table, values in NO_SUBAGENTS.items():
            config[table] = {**config.get(table, {}), **values}
        return config

    @override
    def _resolve_auth_json_path(self) -> Path:
        path = self._login()
        if not path.is_file():
            raise ValueError(f"Login file not found: {path}")
        return path

    @override
    async def _upload_effective_config(
        self, environment: BaseEnvironment, config: dict[str, Any], remote_path: str
    ) -> None:
        await super()._upload_effective_config(environment, config, remote_path)
        await self.exec_as_agent(
            environment,
            command=(
                f"mkdir -p {LOGIN_DIR} && mv {HARBOR_LOGIN} {LOGIN_FILE} && "
                f"ln -s {LOGIN_FILE} {HARBOR_LOGIN}"
            ),
        )

    @override
    async def run(
        self, instruction: str, environment: BaseEnvironment, context: AgentContext
    ) -> None:
        try:
            await super().run(instruction, environment, context)
        finally:
            await self._keep_login(environment)

    def _login(self) -> Path:
        return Path(self.options.login_path).expanduser() if self.options.login_path else DEFAULT_LOGIN

    async def _keep_login(self, environment: BaseEnvironment) -> None:
        """Save a login codex refreshed in the container: refreshing replaces the host's refresh token."""
        try:
            login = await download_json(environment, LOGIN_FILE.as_posix())
            await self.exec_as_agent(environment, command=f"rm -rf {LOGIN_DIR}")
            if store_codex_login(self._login(), login):
                self.logger.info("Saved the container's refreshed login to the host")
        except Exception:
            # Raising would hide the agent's own outcome, such as a timeout.
            self.logger.warning("Could not save the container's login to the host", exc_info=True)
