"""Harbor's opencode agent on OpenCode V2, with subagents off and the Sign in with ChatGPT login."""

from __future__ import annotations

import json
import shlex
from pathlib import Path
from typing import override

from harbor.agents.installed.base import NonZeroAgentExitCodeError, with_prompt_template
from harbor.agents.installed.node_install import nvm_node_install_snippet
from harbor.agents.installed.opencode import OpenCode, OpenCodeOptions
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext
from pydantic import Field

from surgent_bench.agents.common import (
    TOKEN_SHARING,
    BenchAgent,
    BenchOptions,
    download_json,
    read_credential,
    store_credential,
)
from surgent_bench.pricing import COST_DIGITS, calls_cost
from surgent_bench.settings import BENCH_DIR
from surgent_bench.usage import opencode_calls

DEFAULT_LOGIN = BENCH_DIR / ".auth" / "opencode" / "opencode.db"
# Outside the trial logs, where Harbor points XDG_DATA_HOME: the database holds the login.
LOGIN_DIR = "/tmp/opencode-bench"
DATABASE = f"{LOGIN_DIR}/opencode.db"
LOGIN_FILE = f"{LOGIN_DIR}/login.json"
# A private server per command; the background service would outlive the run.
OPENCODE = "[ -f ~/.nvm/nvm.sh ] && . ~/.nvm/nvm.sh; opencode --standalone"
WEB_TOOLS = ("websearch", "webfetch")


class OpenCodeBenchOptions(BenchOptions, OpenCodeOptions):
    login_path: str | None = Field(
        default=None, description="Host opencode database holding the Sign in with ChatGPT login."
    )


class OpenCodeV2(OpenCode):
    """Harbor's agent targets OpenCode V1, whose package, run flags, and login storage differ."""

    options: OpenCodeBenchOptions

    @override
    async def install(self, environment: BaseEnvironment) -> None:
        # opencode downloads rg on first use, which offline tasks block.
        await self.ensure_system_dependencies(
            environment, ("ripgrep", "curl", "bash", "coreutils", "nodejs", "npm")
        )
        version = f"@{self._version}" if self._version else "@latest"
        await self.exec_as_agent(
            environment,
            command=(
                "set -euo pipefail; "
                # nvm's Node does not run on musl, so those images use the packaged one.
                "if ldd --version 2>&1 | grep -qi musl || [ -f /etc/alpine-release ]; then "
                "node --version; "
                f"else {nvm_node_install_snippet()}; fi && "
                f"npm i -g @opencode/cli{version} && "
                "opencode --version"
            ),
        )

    @override
    @with_prompt_template
    async def run(
        self, instruction: str, environment: BaseEnvironment, context: AgentContext
    ) -> None:
        if not self.model_name or "/" not in self.model_name:
            raise ValueError("Model name must be in the format provider/model_name")
        # Harbor's trajectory takes the user turn from it.
        self._instruction = instruction
        env = {
            **self.model_connection.env,
            "OPENCODE_DB": DATABASE,
            "OPENCODE_DISABLE_AUTOUPDATE": "1",
            "XDG_DATA_HOME": (self.environment_logs_dir / "opencode" / "xdg-data").as_posix(),
            "XDG_STATE_HOME": (self.environment_logs_dir / "opencode" / "xdg-state").as_posix(),
        }
        config = shlex.quote(json.dumps({"permissions": self._denied()}, indent=2))
        await self.exec_as_agent(
            environment,
            command=(
                f"mkdir -p {LOGIN_DIR} ~/.config/opencode && "
                f"echo {config} > ~/.config/opencode/opencode.jsonc"
            ),
            env=env,
        )
        credential_id = await self._place_login(environment, env)
        model = f"{self.model_name}#{self.options.variant}" if self.options.variant else self.model_name
        output = shlex.quote((self.environment_logs_dir / self._OUTPUT_FILENAME).as_posix())
        try:
            await self.exec_as_agent(
                environment,
                command=(
                    f"{OPENCODE} run --format json --thinking --auto --model {shlex.quote(model)} "
                    f"{shlex.quote(instruction)} 2>&1 </dev/null | stdbuf -oL tee {output}"
                ),
                env=env,
            )
        finally:
            await self._keep_login(environment, env, credential_id)

        if messages := self._error_messages():
            raise NonZeroAgentExitCodeError(
                "OpenCode emitted error event(s): " + "; ".join(messages[:3])
            )

    def _denied(self) -> list[dict[str, str]]:
        tools = ["subagent", *(WEB_TOOLS if self.options.disable_web_search else ())]
        return [{"action": tool, "resource": "*", "effect": "deny"} for tool in tools]

    def _login(self) -> tuple[Path, str]:
        path = Path(self.options.login_path).expanduser() if self.options.login_path else DEFAULT_LOGIN
        return path, (self.model_name or "").split("/", 1)[0]

    async def _place_login(self, environment: BaseEnvironment, env: dict[str, str]) -> str:
        path, integration = self._login()
        credential = read_credential(path, integration)
        await self._upload_config_text(
            environment, content=json.dumps([credential]), remote_path=LOGIN_FILE, filename="login.json"
        )
        await self.exec_as_agent(
            environment,
            command=(
                f"{OPENCODE} auth import {LOGIN_FILE} </dev/null; "
                f"status=$?; rm -f {LOGIN_FILE}; exit $status"
            ),
            env=env,
        )
        return credential["id"]

    async def _keep_login(
        self, environment: BaseEnvironment, env: dict[str, str], credential_id: str
    ) -> None:
        """Save a login opencode refreshed in the container: refreshing replaces the host's refresh token."""
        path, integration = self._login()
        try:
            await self.exec_as_agent(
                environment,
                command=f"umask 077; {OPENCODE} auth export {integration} > {LOGIN_FILE} </dev/null",
                env=env,
            )
            exported = await download_json(environment, LOGIN_FILE)
            await self.exec_as_agent(environment, command=f"rm -f {LOGIN_FILE}")
            login = next(entry["value"] for entry in exported if entry["value"].get("methodID") == TOKEN_SHARING)
            if store_credential(path, credential_id, login):
                self.logger.info("Saved the container's refreshed login to the host")
        except Exception:
            # Raising would hide the agent's own outcome, such as a timeout.
            self.logger.warning("Could not save the container's login to the host", exc_info=True)


class OpenCodeBench(BenchAgent, OpenCodeV2):
    """Same name as Harbor's opencode so results group under `opencode`."""

    options_model = OpenCodeBenchOptions
    options: OpenCodeBenchOptions

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
