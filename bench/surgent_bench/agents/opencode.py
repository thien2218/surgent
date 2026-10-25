"""Harbor's opencode agent with subagents off and the subscription login."""

from __future__ import annotations

import copy
from dataclasses import replace
from pathlib import Path
from typing import Any, override

from harbor.agents.installed.opencode import OpenCode, OpenCodeOptions
from harbor.agents.model_connection import ResolvedModelConnection
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext
from pydantic import Field

from surgent_bench.agents.common import BenchAgent, BenchOptions, read_login
from surgent_bench.pricing import COST_DIGITS, calls_cost
from surgent_bench.usage import opencode_calls

DEFAULT_LOGIN = Path.home() / ".local" / "share" / "opencode" / "auth.json"
# An auth.json would land in the trial logs, where Harbor points XDG_DATA_HOME.
LOGIN_ENV = "OPENCODE_AUTH_CONTENT"
NO_SUBAGENTS = {"permission": {"task": "deny"}}


class OpenCodeBenchOptions(BenchOptions, OpenCodeOptions):
    login_path: str | None = Field(
        default=None, description="Host opencode auth.json holding the subscription login."
    )


class OpenCodeBench(BenchAgent, OpenCode):
    """Same name as Harbor's opencode so results group under `opencode`."""

    options_model = OpenCodeBenchOptions
    options: OpenCodeBenchOptions

    def __init__(self, *args, opencode_config: dict[str, Any] | None = None, **kwargs):
        super().__init__(*args, opencode_config=opencode_config, **kwargs)
        self._opencode_config = self._deep_merge(copy.deepcopy(NO_SUBAGENTS), self._opencode_config)

    @override
    async def install(self, environment: BaseEnvironment) -> None:
        # opencode downloads rg on first use, which offline tasks block.
        await self.ensure_system_dependencies(environment, ("ripgrep",))
        await super().install(environment)

    @override
    def populate_context_post_run(self, context: AgentContext) -> None:
        super().populate_context_post_run(context)
        try:
            calls = opencode_calls(self.logs_dir)
            main_calls = [call for call in calls if call.is_main]
            if main_calls:
                # Harbor leaves out reasoning, which codex and pi count as output.
                context.n_output_tokens = sum(call.output for call in main_calls)
            # opencode prices subscription calls at $0.
            if context.cost_usd is None:
                context.cost_usd = round(calls_cost(calls, self.model_name or ""), COST_DIGITS)
        except Exception:
            # Harbor does not guard this hook.
            self.logger.warning("Could not read opencode's token usage", exc_info=True)

    @property
    @override
    def model_connection(self) -> ResolvedModelConnection:
        access = super().model_connection
        options = getattr(self, "options", None)
        if options is None:
            return access
        provider = (self.model_name or "").split("/", 1)[0]
        login_path = Path(options.login_path).expanduser() if options.login_path else DEFAULT_LOGIN
        env = dict(access.env)
        env[LOGIN_ENV] = read_login(login_path, provider)
        return replace(access, env=env)
