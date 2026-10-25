"""Surgent through Harbor's `Pi` agent, installed from its prebuilt package tree."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Annotated, override

from harbor.agents.installed.node_install import nvm_node_install_snippet
from harbor.agents.installed.pi import Pi, PiOptions
from harbor.agents.options import Cli
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext
from pydantic import Field, model_validator

from surgent_bench.agents.common import (
    BenchAgent,
    BenchOptions,
    place_home_file,
    read_login,
    store_login,
)

LOGIN_FILE = ".pi/agent/auth.json"
DEFAULT_LOGIN = Path.home() / LOGIN_FILE
PREBUILT_TARGET = "/tmp/surgent-prebuilt.tgz"
WEB_TOOLS = ("web_fetch", "web_search")
SUBAGENT_TOOL = "subagent"

# Surgent skips git-excluding `.pi/` in json mode; graders diff the repo.
PREPARE_REPO = (
    "repo_git() { git -c 'safe.directory=*' \"$@\"; }; "
    'exclude="$(repo_git rev-parse --git-path info/exclude 2>/dev/null)" && '
    'mkdir -p "$(dirname "$exclude")" && '
    '{ grep -qx ".pi" "$exclude" 2>/dev/null || echo ".pi" >> "$exclude"; }; '
    "repo_git rev-parse --show-toplevel 2>/dev/null || true"
)
# An RPC session installs grammars at session_start; closed stdin ends it before any model call.
WARM_GRAMMARS = ". ~/.nvm/nvm.sh; surgent --mode rpc --no-session < /dev/null > /dev/null 2>&1 || true"
# pi downloads rg and fd on first use, which offline tasks block.
FETCH_SEARCH_TOOLS = (
    ". ~/.nvm/nvm.sh; "
    'manager="$(find "$(npm root -g)/surgent" -path "*/pi-coding-agent/dist/utils/tools-manager.js" | head -n 1)" && '
    "node --input-type=module -e \"const { ensureTool } = await import(process.argv[1]); "
    "for (const tool of ['rg', 'fd']) if (!(await ensureTool(tool))) throw new Error(tool + ' unavailable');\" "
    '"$manager"'
)


class SurgentOptions(BenchOptions, PiOptions):
    exclude_tools: Annotated[str | None, Cli("--exclude-tools")] = Field(
        default=None, description="Comma-separated tools hidden from the main agent."
    )
    prebuilt: str = Field(description="Host path to surgent's prebuilt package tree archive.")
    login_path: str | None = Field(
        default=None, description="Host pi auth.json holding the subscription login."
    )

    @model_validator(mode="after")
    def _hide_tools(self):
        hidden = [name for name in (self.exclude_tools or "").split(",") if name]
        hidden.extend((SUBAGENT_TOOL, *WEB_TOOLS))
        self.exclude_tools = ",".join(dict.fromkeys(hidden))
        return self


class Surgent(BenchAgent, Pi):
    options_model = SurgentOptions
    options: SurgentOptions
    # Harbor's 360s default is too short for the rg, fd, and grammar fetches.
    DEFAULT_SETUP_TIMEOUT_SEC = 600.0

    @staticmethod
    @override
    def name() -> str:
        return "surgent"

    @override
    def get_version_command(self) -> str | None:
        return (
            ". ~/.nvm/nvm.sh; npm ls -g surgent --depth=0 --parseable --long "
            "| sed -n 's/.*:surgent@//p'"
        )

    @override
    async def install(self, environment: BaseEnvironment) -> None:
        await self.ensure_system_dependencies(environment, ("curl",))
        await environment.upload_file(Path(self.options.prebuilt), PREBUILT_TARGET)
        await self.exec_as_root(environment, command=f"chmod 644 {PREBUILT_TARGET}")
        await self.exec_as_agent(
            environment,
            command=(
                "set -euo pipefail; "
                f"{nvm_node_install_snippet()} && "
                'modules="$(npm root -g)" && '
                f'tar -xzf {PREBUILT_TARGET} -C "$modules" && '
                'bin_dir="$(dirname "$(command -v node)")" && '
                'ln -sf "$modules/surgent/bin/surgent.js" "$bin_dir/surgent" && '
                # Harbor's pi integration invokes `pi`; route it to surgent.
                'ln -sf "$bin_dir/surgent" "$bin_dir/pi" && '
                "surgent --version"
            ),
        )
        await self._configure(environment)
        await self.exec_as_agent(environment, command=FETCH_SEARCH_TOOLS, timeout_sec=300)
        await self.exec_as_agent(environment, command=WARM_GRAMMARS, timeout_sec=600)
        await self._keep_login(environment)

    @override
    async def run(
        self, instruction: str, environment: BaseEnvironment, context: AgentContext
    ) -> None:
        try:
            await super().run(instruction, environment, context)
        finally:
            await self._keep_login(environment)

    def _login(self) -> tuple[Path, str]:
        path = Path(self.options.login_path).expanduser() if self.options.login_path else DEFAULT_LOGIN
        return path, (self.model_name or "").split("/", 1)[0]

    async def _keep_login(self, environment: BaseEnvironment) -> None:
        """Save a login pi refreshed in the container: refreshing revokes the host's copy."""
        path, provider = self._login()
        try:
            probe = await self.exec_as_agent(environment, command='printf %s "$HOME"')
            with tempfile.TemporaryDirectory(prefix="bench-login-") as temp_dir:
                local = Path(temp_dir) / "auth.json"
                # Copied, not printed: command output reaches the trial logs.
                await environment.download_file(f"{(probe.stdout or '').strip()}/{LOGIN_FILE}", local)
                login = json.loads(local.read_text()).get(provider)
            if login and store_login(path, provider, login):
                self.logger.info("Saved the container's refreshed login to the host")
        except Exception:
            # Raising would hide the agent's own outcome, such as a timeout.
            self.logger.warning("Could not save the container's login to the host", exc_info=True)

    async def _configure(self, environment: BaseEnvironment) -> None:
        probe = await self.exec_as_agent(environment, command=PREPARE_REPO)
        lines = (probe.stdout or "").strip().splitlines()
        repo_root = lines[-1].strip() if lines else ""
        settings = {
            "agent": {"mode": "yolo"},
            "defaultTools": ["+grep", "+find", "+ls", "+codemode"],
            "grammarInstall": {"allowedRepos": [repo_root] if repo_root else []},
        }
        await place_home_file(
            self, environment, json.dumps(settings, indent=2), ".pi/agent/settings.json"
        )

        login_path, provider = self._login()
        await place_home_file(self, environment, read_login(login_path, provider), LOGIN_FILE)
