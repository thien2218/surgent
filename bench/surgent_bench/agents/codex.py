"""Harbor's codex agent with subagents disabled, on the Sign in with ChatGPT login."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, override

from harbor.agents.installed.codex import Codex, CodexOptions
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext
from pydantic import Field

from surgent_bench.agents.common import (
    BenchAgent,
    BenchOptions,
    download_json,
    read_login,
    store_login,
)
from surgent_bench.settings import BENCH_DIR

DEFAULT_LOGIN = BENCH_DIR / ".auth" / "codex" / "auth.json"
# `multi_agent_v2` overrides `[agents] enabled = false`.
NO_SUBAGENTS = {
    "agents": {"enabled": False},
    "features": {"multi_agent": False, "multi_agent_v2": False},
}
SECRETS_DIR = Codex._REMOTE_CODEX_SECRETS_DIR
LOGIN_FILE = SECRETS_DIR / "login.json"
REFRESHER_FILE = SECRETS_DIR / "refresh-login.mjs"
PROVIDER = "chatgpt_plan"
# OpenAI's documented setup for ChatGPT plan tokens; a command supplies them as they expire hourly.
CHATGPT_PLAN = {
    "name": "OpenAI (ChatGPT plan)",
    "base_url": "https://api.openai.com/v1",
    "wire_api": "responses",
    "requires_openai_auth": False,
    "supports_websockets": False,
    "auth": {
        "command": "node",
        "args": [REFRESHER_FILE.as_posix(), LOGIN_FILE.as_posix()],
        "timeout_ms": 60_000,
        "refresh_interval_ms": 5 * 60 * 1000,
    },
}
# Prints the access token, refreshing first when less than ten minutes remain.
# Expiry is stored three minutes early, as pi does, so `store_login` compares like with like.
REFRESHER = """\
import { mkdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from "node:fs";

const TOKEN_URL = "https://auth.openai.com/api/accounts/oauth/token";
const RESOURCE = "https://api.openai.com/v1";
const EXPIRY_MARGIN_MS = 3 * 60 * 1000;
const REFRESH_AHEAD_MS = 10 * 60 * 1000;
const path = process.argv[2];
const lock = `${path}.lock`;

for (let waited = 0; ; waited += 100) {
  try {
    mkdirSync(lock);
    break;
  } catch (error) {
    if (error.code !== "EEXIST" || waited > 30000) throw error;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
try {
  let login = JSON.parse(readFileSync(path, "utf8"));
  if (login.expires - Date.now() < REFRESH_AHEAD_MS) {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: login.clientId,
        refresh_token: login.refresh,
        resource: RESOURCE,
      }),
    });
    if (!response.ok) {
      throw new Error(`OpenAI token refresh failed (${response.status}): ${await response.text()}`);
    }
    const token = await response.json();
    login = {
      ...login,
      access: token.access_token,
      refresh: token.refresh_token,
      expires: Date.now() + token.expires_in * 1000 - EXPIRY_MARGIN_MS,
      scopes: token.scope.split(" "),
    };
    writeFileSync(`${path}.next`, JSON.stringify(login), { mode: 0o600 });
    renameSync(`${path}.next`, path);
  }
  process.stdout.write(login.access);
} finally {
  rmdirSync(lock);
}
"""


class CodexBenchOptions(BenchOptions, CodexOptions):
    login_path: str | None = Field(
        default=None, description="Host auth.json holding the Sign in with ChatGPT login."
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
        config["model_provider"] = PROVIDER
        config["model_providers"] = {**config.get("model_providers", {}), PROVIDER: CHATGPT_PLAN}
        return config

    @override
    async def run(
        self, instruction: str, environment: BaseEnvironment, context: AgentContext
    ) -> None:
        await self._place_login(environment)
        try:
            await super().run(instruction, environment, context)
        finally:
            await self._keep_login(environment)

    def _login(self) -> tuple[Path, str]:
        path = Path(self.options.login_path).expanduser() if self.options.login_path else DEFAULT_LOGIN
        return path, (self.model_name or "").split("/", 1)[0]

    async def _place_login(self, environment: BaseEnvironment) -> None:
        path, provider = self._login()
        login = json.loads(read_login(path, provider))[provider]
        await self.exec_as_agent(environment, command=f"mkdir -p {SECRETS_DIR}")
        for remote, content in ((REFRESHER_FILE, REFRESHER), (LOGIN_FILE, json.dumps(login))):
            await self._upload_config_text(
                environment, content=content, remote_path=remote.as_posix(), filename=remote.name
            )

    async def _keep_login(self, environment: BaseEnvironment) -> None:
        """Save a login the refresher renewed: refreshing replaces the host's refresh token."""
        path, provider = self._login()
        try:
            login = await download_json(environment, LOGIN_FILE.as_posix())
            if store_login(path, provider, login):
                self.logger.info("Saved the container's refreshed login to the host")
        except Exception:
            # Raising would hide the agent's own outcome, such as a timeout.
            self.logger.warning("Could not save the container's login to the host", exc_info=True)
