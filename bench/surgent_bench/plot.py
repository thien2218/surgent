"""Line chart of context usage per turn, with its values as CSV."""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402
from matplotlib.axes import Axes  # noqa: E402
from matplotlib.ticker import FuncFormatter, MaxNLocator  # noqa: E402

from surgent_bench.collect import valid_mask  # noqa: E402

# Validated categorical slots 1-3 (all-pairs CVD safe); color follows the agent.
HARNESS_COLORS = {"surgent": "#2a78d6", "codex": "#eb6834", "opencode": "#1baf7a"}
SURFACE = "#fcfcfb"
TEXT_PRIMARY = "#0b0b0b"
TEXT_SECONDARY = "#52514e"
GRID = "#e6e5e1"
BAND_ALPHA = 0.10


def _style(axes: Axes, title: str, ylabel: str, xlabel: str) -> None:
    axes.set_facecolor(SURFACE)
    axes.set_title(title, loc="left", color=TEXT_PRIMARY, fontsize=11, fontweight="bold")
    axes.set_ylabel(ylabel, color=TEXT_SECONDARY, fontsize=9)
    axes.set_xlabel(xlabel, color=TEXT_SECONDARY, fontsize=9)
    axes.grid(axis="y", color=GRID, linewidth=1)
    axes.set_axisbelow(True)
    axes.tick_params(colors=TEXT_SECONDARY, labelsize=8, length=0)
    for side in ("top", "right", "left"):
        axes.spines[side].set_visible(False)
    axes.spines["bottom"].set_color(GRID)


LABEL_GAP_POINTS = 11


def _line(axes: Axes, harness: str, xs, ys) -> None:
    axes.plot(
        xs,
        ys,
        color=HARNESS_COLORS.get(harness, TEXT_SECONDARY),
        linewidth=2,
        solid_capstyle="round",
        solid_joinstyle="round",
        label=harness,
    )


def _label_ends(figure, panels) -> None:
    """Label each line's end, nudged apart when crowded; runs after layout."""
    figure.canvas.draw()
    points_per_pixel = 72 / figure.dpi
    for axes in panels:
        ends = []
        for line in axes.get_lines():
            xs, ys = line.get_xdata(), line.get_ydata()
            if len(xs):
                pixel_y = axes.transData.transform((xs[-1], ys[-1]))[1]
                ends.append([pixel_y, pixel_y, xs[-1], ys[-1], line.get_label()])
        ends.sort(key=lambda end: end[0])
        gap = LABEL_GAP_POINTS / points_per_pixel
        for position in range(1, len(ends)):
            ends[position][1] = max(ends[position][1], ends[position - 1][1] + gap)
        for original, placed, last_x, last_y, label in ends:
            axes.annotate(
                label,
                (last_x, last_y),
                xytext=(6, (placed - original) * points_per_pixel),
                textcoords="offset points",
                va="center",
                color=TEXT_SECONDARY,
                fontsize=8,
                annotation_clip=False,
            )


def _label_room(panels) -> None:
    """Widen each x-axis so end labels sit inside the plot area."""
    for axes in panels:
        left, right = axes.get_xlim()
        axes.set_xlim(left, right + (right - left) * 0.12)


def _thousands(value: float, _position: int) -> str:
    return f"{value / 1000:.0f}k" if abs(value) >= 1000 else f"{value:.0f}"


def _legend(figure, axes: Axes) -> None:
    handles, labels = axes.get_legend_handles_labels()
    if handles:
        figure.legend(
            handles,
            labels,
            loc="upper right",
            ncol=len(labels),
            frameon=False,
            fontsize=9,
            labelcolor=TEXT_PRIMARY,
        )


def _trial_key(frame: pd.DataFrame) -> pd.Series:
    return frame["job"].astype(str) + "/" + frame["trial"].astype(str)


def _quartile(share: float):
    return lambda values: values.quantile(share)


def session_curves(calls: pd.DataFrame, trials: pd.DataFrame, min_trials: int) -> pd.DataFrame:
    """Per harness and turn: prompt-token median and quartiles, dropping turns fewer than `min_trials` reached."""
    main = calls[calls["is_main"]].copy()
    main["key"] = _trial_key(main)
    main = main[main["key"].isin(_trial_key(trials[valid_mask(trials)]))]
    curves = (
        main.groupby(["harness", "turn"])
        .agg(
            running=("key", "nunique"),
            context_median=("prompt_tokens", "median"),
            context_q1=("prompt_tokens", _quartile(0.25)),
            context_q3=("prompt_tokens", _quartile(0.75)),
        )
        .reset_index()
    )
    return curves[curves["running"] >= min_trials]


def plot_session(curves: pd.DataFrame, out_path: Path, min_trials: int) -> None:
    figure, context = plt.subplots(figsize=(8, 4.8))
    figure.patch.set_facecolor(SURFACE)
    _style(context, "Context usage", "Prompt tokens (median)", "Turn")
    for harness, group in curves.groupby("harness", sort=True):
        color = HARNESS_COLORS.get(harness, TEXT_SECONDARY)
        context.fill_between(
            group["turn"], group["context_q1"], group["context_q3"],
            color=color, alpha=BAND_ALPHA, linewidth=0,
        )
        _line(context, harness, group["turn"], group["context_median"])
    context.yaxis.set_major_formatter(FuncFormatter(_thousands))
    context.xaxis.set_major_locator(MaxNLocator(integer=True))
    context.set_xlim(left=1)
    _label_room([context])
    _legend(figure, context)
    figure.text(
        0.01,
        0.015,
        "Line: median prompt size over the trials that reached each turn. "
        "Band: middle 50% of those trials (25th to 75th percentile).\n"
        "A turn is one model response, with any tool calls it makes. "
        f"Turns fewer than {min_trials} trials reached are not drawn.",
        color=TEXT_SECONDARY,
        fontsize=7.5,
        va="bottom",
    )
    figure.tight_layout(rect=(0, 0.07, 1, 0.95))
    _label_ends(figure, [context])
    figure.savefig(out_path, dpi=160, facecolor=SURFACE)
    figure.savefig(out_path.with_suffix(".svg"), facecolor=SURFACE)
    plt.close(figure)


def _read(path: Path) -> pd.DataFrame:
    try:
        return pd.read_csv(path)
    except (FileNotFoundError, pd.errors.EmptyDataError):
        return pd.DataFrame()


def plot_all(results_dir: Path, min_trials: int) -> list[Path]:
    calls = _read(results_dir / "calls.csv")
    trials = _read(results_dir / "trials.csv")
    if calls.empty or trials.empty:
        return []
    session = session_curves(calls, trials, min_trials)
    if session.empty:
        return []
    session.to_csv(results_dir / "session_curve.csv", index=False)
    plot_session(session, results_dir / "session.png", min_trials)
    return [results_dir / "session.png"]
