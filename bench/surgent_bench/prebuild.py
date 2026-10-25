"""Surgent's installed package tree, built once per build so trials skip compiling tree-sitter."""

from __future__ import annotations

import hashlib
import os
import re
import subprocess
import tempfile
from pathlib import Path

from surgent_bench.settings import BENCH_DIR, REPO_DIR, SURGENT_PREFIX

# Older glibc and libstdc++ than any task image, so the tree loads on all of them.
BUILD_IMAGE = "node:22-bullseye"
ARCHIVE_NAME = re.compile(rf"{SURGENT_PREFIX}([0-9a-f]{{16}})\.tgz")


def prebuilt_archive(build: str) -> Path:
    return BENCH_DIR / f"{SURGENT_PREFIX}{build}.tgz"


def find_build() -> str | None:
    """The build of the one prebuilt archive in bench/, or None without exactly one."""
    builds = [
        match[1]
        for path in BENCH_DIR.glob(f"{SURGENT_PREFIX}*.tgz")
        if (match := ARCHIVE_NAME.fullmatch(path.name))
    ]
    return builds[0] if len(builds) == 1 else None


def prebuild_checkout() -> str:
    """Build the checkout's package tree unless that build exists; drop other builds."""
    # Inside bench/, as Docker may not see the system temp dir (snap's private /tmp).
    with tempfile.TemporaryDirectory(prefix=".pack-", dir=BENCH_DIR) as pack_dir:
        subprocess.run(
            ["npm", "pack", "--pack-destination", pack_dir, "--loglevel", "warn"],
            cwd=REPO_DIR,
            stdout=subprocess.DEVNULL,
            check=True,
        )
        tarball = next(Path(pack_dir).glob("*.tgz"))
        # npm pack is reproducible, so an unchanged checkout keeps its build.
        build = hashlib.sha256(tarball.read_bytes()).hexdigest()[:16]
        archive = prebuilt_archive(build)
        if not archive.is_file():
            install_tree(tarball, archive)
    for stale in BENCH_DIR.glob(f"{SURGENT_PREFIX}*.tgz"):
        if stale != archive:
            stale.unlink()
    return build


def install_tree(tarball: Path, archive: Path) -> None:
    # Streamed out on stdout, so install scripts get no writable host mount.
    # Dropping "^" installs the exact dependency versions package.json names.
    script = (
        "set -euo pipefail; "
        "mkdir /tmp/package && tar -xzf /tmp/surgent.tgz -C /tmp/package; "
        "sed -i 's/\"\\^/\"/g' /tmp/package/package/package.json; "
        "tar -czf /tmp/pinned.tgz -C /tmp/package package; "
        "npm install -g --prefix /tmp/prefix /tmp/pinned.tgz >&2; "
        "tar -czf - -C /tmp/prefix/lib/node_modules surgent"
    )
    partial = archive.with_suffix(".partial")
    with partial.open("wb") as output:
        subprocess.run(
            [
                "docker", "run", "--rm",
                "--user", f"{os.getuid()}:{os.getgid()}",
                "-e", "HOME=/tmp",
                "-v", f"{tarball.resolve()}:/tmp/surgent.tgz:ro",
                BUILD_IMAGE, "bash", "-c", script,
            ],
            stdout=output,
            check=True,
        )
    partial.rename(archive)
