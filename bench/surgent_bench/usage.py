"""Per-call token usage from each harness's native logs; subagent calls are tagged so `collect` can flag them."""

from __future__ import annotations

import json
import shutil
import sqlite3
import tempfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterator

MAIN = "main"
SUBAGENT = "subagent"
OPENCODE_AUX_AGENTS = {"compaction", "summary", "title"}


@dataclass
class Call:
    # MAIN, SUBAGENT, or main-session upkeep such as compaction.
    role: str
    timestamp: datetime
    uncached: int
    cached: int
    cache_write: int
    output: int
    reasoning: int
    effort: str | None = None
    model: str | None = None

    @property
    def prompt_tokens(self) -> int:
        """Tokens the model read: the context size at this call."""
        return self.uncached + self.cached + self.cache_write

    @property
    def is_main(self) -> bool:
        return self.role == MAIN


def _int(value: Any) -> int:
    return int(value) if isinstance(value, (int, float)) else 0


def _iso(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _millis(value: Any) -> datetime | None:
    if not isinstance(value, (int, float)):
        return None
    return datetime.fromtimestamp(value / 1000, tz=UTC)


def _jsonl(path: Path) -> Iterator[dict[str, Any]]:
    with path.open(errors="replace") as handle:
        for line in handle:
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(entry, dict):
                yield entry


def _pi_entry(entry: dict[str, Any]) -> Call | None:
    when = _iso(entry.get("timestamp"))
    if when is None:
        return None
    entry_type = entry.get("type")
    if entry_type in {"compaction", "branch_summary", "usage"}:
        usage = entry.get("usage")
        return _pi_call(usage, str(entry_type), when, None) if isinstance(usage, dict) else None
    message = entry.get("message")
    if entry_type != "message" or not isinstance(message, dict):
        return None
    usage = message.get("usage")
    if message.get("role") != "assistant" or not isinstance(usage, dict):
        return None
    effort = message.get("providerThinkingLevel") or message.get("thinkingLevel")
    call = _pi_call(usage, MAIN, when, effort)
    call.model = message.get("model")
    return call


def surgent_calls(agent_dir: Path) -> list[Call]:
    seen: set[str] = set()
    calls: list[Call] = []
    for path in sorted((agent_dir / "pi" / "sessions").glob("**/*.jsonl")):
        for entry in _jsonl(path):
            entry_id = entry.get("id")
            if entry_id is not None:
                if str(entry_id) in seen:
                    continue
                seen.add(str(entry_id))
            call = _pi_entry(entry)
            if call is not None and (call.prompt_tokens or call.output):
                calls.append(call)
    return calls


def _pi_call(usage: dict[str, Any], role: str, when: datetime, effort: Any) -> Call:
    return Call(
        role=role,
        timestamp=when,
        uncached=_int(usage.get("input")),
        cached=_int(usage.get("cacheRead")),
        cache_write=_int(usage.get("cacheWrite")),
        output=_int(usage.get("output")),
        reasoning=_int(usage.get("reasoning")),
        effort=effort if isinstance(effort, str) else None,
    )


def _codex_usage(usage: dict[str, Any]) -> tuple[int, int, int, int, int]:
    """(uncached, cached, cache_write, output, reasoning); input is inclusive."""
    cached = _int(usage.get("cached_input_tokens"))
    cache_write = _int(usage.get("cache_write_input_tokens"))
    uncached = max(_int(usage.get("input_tokens")) - cached - cache_write, 0)
    return (
        uncached,
        cached,
        cache_write,
        _int(usage.get("output_tokens")),
        _int(usage.get("reasoning_output_tokens")),
    )


def _session_meta(entries: list[dict[str, Any]]) -> dict[str, Any] | None:
    meta = next(
        (entry.get("payload") for entry in entries if entry.get("type") == "session_meta"), None
    )
    return meta if isinstance(meta, dict) else None


def _thread_role(meta: dict[str, Any]) -> str:
    if meta.get("parent_thread_id") or meta.get("thread_source") == "subagent":
        return SUBAGENT
    return MAIN


def _codex_file(
    entries: list[dict[str, Any]],
    roles: dict[str, str],
    seen: set[tuple[str, str]],
) -> list[Call]:
    meta = _session_meta(entries)
    if meta is None:
        return []
    thread_id = str(meta.get("id"))
    # Forked children copy parent history; usage before this point is not theirs.
    history_start = meta.get("subagent_history_start_ordinal")
    has_records = any(entry.get("type") == "token_usage_record" for entry in entries)

    calls: list[Call] = []
    effort: str | None = None
    model: str | None = None
    last_total = -1
    for entry in entries:
        ordinal = entry.get("ordinal")
        if isinstance(history_start, int) and isinstance(ordinal, int) and ordinal < history_start:
            continue
        payload = entry.get("payload") if isinstance(entry.get("payload"), dict) else {}
        when = _iso(entry.get("timestamp"))
        if entry.get("type") == "turn_context":
            effort = payload.get("effort") or effort
            model = payload.get("model") or model
            continue
        if when is None:
            continue
        usage: dict[str, Any] | None = None
        owner = thread_id
        key: tuple[str, str] | None = None
        if has_records and entry.get("type") == "token_usage_record":
            usage = payload.get("usage") if isinstance(payload.get("usage"), dict) else None
            # A record names its own thread, whichever rollout file holds it.
            owner = str(payload.get("thread_id") or thread_id)
            key = (owner, str(payload.get("response_id")))
        elif not has_records and payload.get("type") == "token_count":
            info = payload.get("info") if isinstance(payload.get("info"), dict) else {}
            total = info.get("total_token_usage") or {}
            total_tokens = _int(total.get("total_tokens"))
            # Codex re-emits token_count without a new call (rate-limit updates).
            if total_tokens <= last_total:
                continue
            last_total = total_tokens
            last_usage = info.get("last_token_usage")
            usage = last_usage if isinstance(last_usage, dict) else None
            key = (thread_id, str(total_tokens))
        if usage is None or key is None or key in seen:
            continue
        seen.add(key)
        uncached, cached, cache_write, output, reasoning = _codex_usage(usage)
        calls.append(
            Call(
                roles.get(owner, SUBAGENT),
                when,
                uncached,
                cached,
                cache_write,
                output,
                reasoning,
                effort,
                model,
            )
        )
    return calls


def codex_calls(agent_dir: Path) -> list[Call]:
    rollouts = [
        list(_jsonl(path)) for path in sorted((agent_dir / "sessions").glob("**/rollout-*.jsonl"))
    ]
    roles: dict[str, str] = {}
    for entries in rollouts:
        meta = _session_meta(entries)
        if meta is not None:
            roles[str(meta.get("id"))] = _thread_role(meta)
    seen: set[tuple[str, str]] = set()
    calls: list[Call] = []
    for entries in rollouts:
        calls.extend(_codex_file(entries, roles, seen))
    return calls


def _opencode_db(agent_dir: Path) -> Path | None:
    candidates = sorted((agent_dir / "opencode" / "xdg-data" / "opencode").glob("opencode*.db"))
    return candidates[0] if candidates else None


def opencode_calls(agent_dir: Path) -> list[Call]:
    database = _opencode_db(agent_dir)
    if database is None:
        return []
    with tempfile.TemporaryDirectory(prefix="bench-opencode-") as temp_dir:
        # With WAL sidecars, so uncheckpointed writes are visible.
        for source in database.parent.glob(f"{database.name}*"):
            shutil.copy2(source, Path(temp_dir) / source.name)
        connection = sqlite3.connect(Path(temp_dir) / database.name)
        try:
            parents = dict(connection.execute("SELECT id, parent_id FROM session").fetchall())
            rows = connection.execute(
                "SELECT part.session_id, part.data, message.data FROM part "
                "JOIN message ON message.id = part.message_id ORDER BY part.id"
            ).fetchall()
        finally:
            connection.close()

    calls: list[Call] = []
    for session_id, part_text, message_text in rows:
        part = json.loads(part_text)
        if part.get("type") != "step-finish":
            continue
        message = json.loads(message_text)
        when = _millis((message.get("time") or {}).get("created"))
        if when is None:
            continue
        tokens = part.get("tokens") or {}
        cache = tokens.get("cache") or {}
        agent = str(message.get("agent") or "")
        if parents.get(session_id):
            role = SUBAGENT
        elif agent in OPENCODE_AUX_AGENTS:
            role = agent
        else:
            role = MAIN
        reasoning = _int(tokens.get("reasoning"))
        calls.append(
            Call(
                role=role,
                timestamp=when,
                # opencode excludes cache from input and reasoning from output.
                uncached=_int(tokens.get("input")),
                cached=_int(cache.get("read")),
                cache_write=_int(cache.get("write")),
                output=_int(tokens.get("output")) + reasoning,
                reasoning=reasoning,
                effort=message.get("variant"),
                model=message.get("modelID"),
            )
        )
    return calls


def harness_calls(harness: str, agent_dir: Path) -> list[Call]:
    if harness == "surgent":
        calls = surgent_calls(agent_dir)
    elif harness == "codex":
        calls = codex_calls(agent_dir)
    else:
        calls = opencode_calls(agent_dir)
    return sorted(calls, key=lambda call: call.timestamp)
