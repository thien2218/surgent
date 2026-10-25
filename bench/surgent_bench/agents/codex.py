"""Harbor's codex agent with subagents disabled."""

from __future__ import annotations

from typing import Any, override

from harbor.agents.installed.codex import Codex, CodexOptions

from surgent_bench.agents.common import BenchAgent, BenchOptions

# `multi_agent_v2` overrides `[agents] enabled = false`.
NO_SUBAGENTS = {
    "agents": {"enabled": False},
    "features": {"multi_agent": False, "multi_agent_v2": False},
}


class CodexBenchOptions(BenchOptions, CodexOptions):
    pass


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
