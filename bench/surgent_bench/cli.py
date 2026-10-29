"""`surgent-bench` command line."""

from __future__ import annotations

import argparse
import shutil
import subprocess
from datetime import UTC, datetime
from importlib.metadata import version
from pathlib import Path

from surgent_bench.settings import (
    DEFAULT_CONFIG,
    SURGENT_PREFIX,
    BenchConfig,
    load_config,
    resolve_path,
)


def _preflight(config: BenchConfig, _args: argparse.Namespace) -> None:
    from harbor.environments.docker.docker import DockerEnvironment

    from surgent_bench.driver import suite_tasks
    from surgent_bench.prebuild import prebuild_checkout, prebuilt_archive
    from surgent_bench.quota import login_expiries

    print(f"Model: {config.model} at effort {config.effort}")
    print(f"harbor: {version('harbor')}")
    docker = shutil.which("docker")
    docker_ok = docker is not None and subprocess.run(
        [docker, "info"], capture_output=True
    ).returncode == 0
    print(f"docker: {'ok' if docker_ok else 'unavailable'}")
    # Without it, tasks that cut network access fail to start.
    if docker_ok and not DockerEnvironment._egress_control_kernel_support():
        print(
            "docker network blocking: unavailable (kernel lacks CONFIG_NFT_FIB_INET); "
            "DeepSWE and two Terminal-Bench tasks will fail"
        )
    now = datetime.now(UTC)
    for harness, expiry in login_expiries(config.auth).items():
        if expiry is None:
            print(f"login {harness}: missing or unreadable")
        else:
            hours = (expiry - now).total_seconds() / 3600
            print(f"login {harness}: access token valid for {hours:.1f}h")
    for suite in config.suites:
        print(f"suite {suite.name}: {len(suite_tasks(suite, config.seed))} tasks")
    # Last, as it takes minutes.
    if docker_ok:
        print(f"surgent prebuilt: {prebuilt_archive(prebuild_checkout()).name}")
    else:
        print("surgent prebuilt: skipped, docker unavailable")


def _quota(config: BenchConfig, _args: argparse.Namespace) -> None:
    from surgent_bench.quota import latest_rate_limits, round_usage

    limits = latest_rate_limits(config.jobs_dir)
    usage = round_usage(config.jobs_dir)
    for round_name, delta in usage:
        print(f"  {round_name}: {delta:.2f}% of weekly")
    if usage and limits is not None and limits.weekly is not None:
        mean = sum(delta for _round_name, delta in usage) / len(usage)
        headroom = 100 - limits.weekly.used_percent
        if mean > 0:
            print(f"Mean {mean:.2f}% per round; about {headroom / mean:.0f} rounds left this week")


def _run(config: BenchConfig, args: argparse.Namespace) -> None:
    from surgent_bench.driver import run_all

    run_all(config, limit=args.limit)


def _surgent_build(config: BenchConfig, requested: str | None) -> str:
    """The surgent build to report: one matching `requested`, else the prebuilt one."""
    from surgent_bench.prebuild import find_build

    if requested is None:
        build = find_build()
        if build is None:
            raise SystemExit("surgent needs exactly one prebuilt build; run `preflight` or pass --surgent-build")
        return build
    builds = {
        # Drop the attempt suffix of `surgent-<build>-2` and later trials.
        path.name.removeprefix(SURGENT_PREFIX).split("-")[0]
        for path in config.jobs_dir.glob(f"*/*/{SURGENT_PREFIX}{requested}*")
    }
    if len(builds) != 1:
        raise SystemExit(f"--surgent-build {requested} matches {len(builds)} builds in {config.jobs_dir}")
    return builds.pop()


def _collect(config: BenchConfig, args: argparse.Namespace) -> None:
    from surgent_bench.collect import collect, consistency_warnings, summarize

    out_dir = resolve_path(args.results)
    build = _surgent_build(config, args.surgent_build)
    print(f"surgent build {build}")
    frames = collect(config.jobs_dir, out_dir, config.suites, build, config.max_trials)
    if frames["trials"].empty:
        print(f"No trials in {config.jobs_dir}; left {out_dir} unchanged")
        return
    print(summarize(frames["trials"]))
    for warning in consistency_warnings(frames["trials"]):
        print(f"warning: {warning}")
    print(f"CSVs written to {out_dir}")


def _plot(_config: BenchConfig, args: argparse.Namespace) -> None:
    from surgent_bench.plot import plot_all

    for path in plot_all(resolve_path(args.results), args.min_trials):
        print(path)


def main() -> None:
    parser = argparse.ArgumentParser(prog="surgent-bench", description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    commands = parser.add_subparsers(dest="command", required=True)

    commands.add_parser("preflight", help="check tools, logins, and quota").set_defaults(
        handler=_preflight
    )
    commands.add_parser("quota", help="show quota use per round").set_defaults(handler=_quota)

    run = commands.add_parser("run", help="run interleaved rounds")
    run.add_argument("--limit", type=int, help="run only the first N rounds")
    run.set_defaults(handler=_run)

    collect = commands.add_parser("collect", help="parse jobs into CSVs")
    collect.add_argument("--results", default="results")
    collect.add_argument(
        "--surgent-build", help="digest prefix of the surgent build to report (default: the prebuilt one)"
    )
    collect.set_defaults(handler=_collect)

    plot = commands.add_parser("plot", help="draw the context usage chart from CSVs")
    plot.add_argument("--results", default="results")
    plot.add_argument(
        "--min-trials", type=int, default=5, help="hide turns fewer trials than this reached"
    )
    plot.set_defaults(handler=_plot)

    args = parser.parse_args()
    args.handler(load_config(args.config), args)


if __name__ == "__main__":
    main()
