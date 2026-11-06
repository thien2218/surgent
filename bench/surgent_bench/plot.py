"""Bar charts of context usage per task for each agent, with their values as CSV."""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402
from matplotlib.axes import Axes  # noqa: E402
from matplotlib.colors import to_hex, to_rgb  # noqa: E402
from matplotlib.ticker import FuncFormatter  # noqa: E402

from surgent_bench.collect import shared_trials  # noqa: E402

# Validated categorical slots 1-3 (all-pairs CVD safe); color follows the agent.
HARNESS_COLORS = {"surgent": "#2a78d6", "codex": "#eb6834", "opencode": "#1baf7a"}
# Surgent leads at full strength; the agents it is compared with are lighter.
ORDER = ["surgent", "codex", "opencode"]
COMPARED_TINT = 0.3
SURFACE = "#fcfcfb"
TEXT_PRIMARY = "#0b0b0b"
TEXT_SECONDARY = "#52514e"
AXIS = "#c3c2b7"
GRID = "#e6e5e1"
SUITE_NAMES = {"deepswe": "DeepSWE", "terminal-bench": "Terminal-Bench"}
PANELS = [
    ("peak_context", "Peak context", lambda value: f"{value / 1000:.0f}k" if value else "0"),
    ("turns", "Turns per task", lambda value: f"{value:.3g}"),
]
COLUMNS = [column for column, _title, _label in PANELS]
STATS = [
    ("average", "Average", lambda values: values.mean()),
    ("median", "Median", lambda values: values.median()),
    ("p90", "90th percentile", lambda values: values.quantile(0.9)),
]


def task_stats(shared: pd.DataFrame) -> pd.DataFrame:
    """Per stat and harness: that stat over tasks of each task's mean over its trials."""
    per_task = shared.groupby(["harness", "job"])[COLUMNS].mean()
    tasks = per_task.groupby("harness").size()
    order = [harness for harness in ORDER if harness in tasks.index]
    order += sorted(set(tasks.index) - set(order))
    frames = []
    for stat, _name, reduce in STATS:
        values = per_task.groupby("harness").agg(reduce).reindex(order)
        values.insert(0, "tasks", tasks)
        values.insert(0, "stat", stat)
        frames.append(values)
    return pd.concat(frames)


def _scope(shared: pd.DataFrame) -> str:
    tasks = shared.groupby("suite")["job"].nunique()
    suites = " + ".join(f"{count} {SUITE_NAMES.get(suite, suite)}" for suite, count in tasks.items())
    models = ", ".join(sorted({str(model).split("/")[-1] for model in shared["model"].dropna()}))
    efforts = ", ".join(sorted(shared["effort"].dropna().astype(str).unique()))
    return f"{suites} tasks · {models} ({efforts})"


def _tint(color: str, strength: float) -> str:
    """`color` mixed into the surface; opaque, so gridlines stay hidden behind the bar."""
    return to_hex(
        [
            background + (channel - background) * strength
            for channel, background in zip(to_rgb(color), to_rgb(SURFACE))
        ]
    )


def _panel(axes: Axes, values: pd.DataFrame, column: str, title: str, label) -> None:
    columns = range(len(values))
    for position, (harness, value) in zip(columns, values[column].items()):
        color = HARNESS_COLORS.get(harness, TEXT_SECONDARY)
        axes.bar(
            position,
            value,
            width=0.6,
            color=color if harness == "surgent" else _tint(color, COMPARED_TINT),
        )
        axes.annotate(
            label(value),
            (position, value),
            xytext=(0, 4),
            textcoords="offset points",
            ha="center",
            color=TEXT_PRIMARY,
            fontsize=10,
        )
    axes.set_title(title, color=TEXT_PRIMARY, fontsize=11, fontweight="bold", pad=14)
    axes.set_ylim(0, values[column].max() * 1.15)
    axes.set_facecolor(SURFACE)
    axes.yaxis.set_major_formatter(FuncFormatter(lambda value, _position: label(value)))
    axes.grid(axis="y", color=GRID, linewidth=1)
    axes.set_axisbelow(True)
    axes.set_xticks(list(columns), values.index)
    axes.tick_params(axis="x", length=0, labelsize=10, colors=TEXT_PRIMARY)
    axes.tick_params(axis="y", length=0, labelsize=9, colors=TEXT_SECONDARY)
    for side in ("top", "right"):
        axes.spines[side].set_visible(False)
    for side in ("bottom", "left"):
        axes.spines[side].set_color(AXIS)


def plot_stat(values: pd.DataFrame, headline: str, subtitle: str, out_path: Path) -> None:
    figure, panels = plt.subplots(1, len(PANELS), figsize=(8, 5))
    figure.patch.set_facecolor(SURFACE)
    for axes, (column, title, label) in zip(panels, PANELS):
        _panel(axes, values, column, title, label)
    figure.suptitle(
        headline,
        x=0.01,
        y=0.97,
        ha="left",
        fontsize=12,
        fontweight="bold",
        color=TEXT_PRIMARY,
    )
    figure.text(0.01, 0.905, subtitle, color=TEXT_SECONDARY, fontsize=9)
    figure.tight_layout(rect=(0, 0, 1, 0.88), w_pad=6)
    figure.savefig(out_path, facecolor=SURFACE)
    plt.close(figure)


def _read(path: Path) -> pd.DataFrame:
    try:
        return pd.read_csv(path)
    except (FileNotFoundError, pd.errors.EmptyDataError):
        return pd.DataFrame()


def plot_all(results_dir: Path) -> list[Path]:
    trials = _read(results_dir / "trials.csv")
    if trials.empty:
        return []
    shared = shared_trials(trials)
    if shared.empty or "surgent" not in set(shared["harness"]) or shared["harness"].nunique() < 2:
        return []
    stats = task_stats(shared)
    stats.round(1).to_csv(results_dir / "session.csv", index_label="harness")
    scope = _scope(shared)
    paths = []
    for stat, name, _reduce in STATS:
        path = results_dir / f"session-{stat}.svg"
        plot_stat(stats[stats["stat"] == stat], f"{name} peak context", scope, path)
        paths.append(path)
    return paths
