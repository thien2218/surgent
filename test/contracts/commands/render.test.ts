import { initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { renderSnapshotWidget, showPlanUi } from "../../../src/commands/render.js";
import type { SubsessionSnapshot } from "../../../src/subagent/types.js";
import { commandContext } from "../../helpers/commands.js";

function text(component: Component, width = 100) {
  return component.render(width).map(stripTerminalSequences).join("\n");
}

beforeAll(() => {
  initTheme("dark", false);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("plan review UI contract", () => {
  it.each([null, "/workspace/plan.md"])(
    "offers actions appropriate to saved path %j",
    async (path) => {
      const { ctx, interact } = commandContext("/unused");
      interact((component) => {
        const rendered = text(component);
        expect(rendered).toContain("Review this plan");
        expect(rendered).toContain("Implement this plan");
        expect(rendered).toContain("Save and exit");
        expect(rendered.includes("Open plan in external editor")).toBe(path !== null);
        component.handleInput?.("\x1b");
      });

      expect(await showPlanUi(ctx, "Review this plan", path)).toEqual({ kind: "discard" });
    },
  );

  it("shows a fallback when planner output is whitespace", async () => {
    const { ctx, interact } = commandContext("/unused");
    interact((component) => {
      expect(text(component)).toContain("No planner output yet.");
      component.handleInput?.("\x1b");
    });

    await showPlanUi(ctx, " \n ", null);
  });

  it.each([
    { down: 0, action: "forward" },
    { down: 1, action: "open" },
    { down: 2, action: "save" },
  ])("maps selected $action option to its loop action", async ({ down, action }) => {
    const { ctx, interact } = commandContext("/unused");
    interact((component) => {
      component.handleInput?.("\t");
      for (let index = 0; index < down; index++) component.handleInput?.("\x1b[B");
      component.handleInput?.("\r");
    });

    expect(await showPlanUi(ctx, "Plan", "/workspace/plan.md")).toEqual({ kind: action });
  });

  it("returns typed feedback rather than forwarding the plan", async () => {
    const { ctx, interact } = commandContext("/unused");
    interact((component) => {
      component.handleInput?.("\t");
      component.handleInput?.("\x1b[B");
      component.handleInput?.("\x1b[B");
      component.handleInput?.("  Add rollback steps  ");
      component.handleInput?.("\r");
    });

    expect(await showPlanUi(ctx, "Plan", null)).toEqual({
      kind: "feedback",
      feedback: "Add rollback steps",
    });
  });

  it.each([false, true])("discards on Escape with action focus %j", async (editing) => {
    const { ctx, interact } = commandContext("/unused");
    interact((component) => {
      if (editing) component.handleInput?.("\t");
      component.handleInput?.("\x1b");
    });

    expect(await showPlanUi(ctx, "Plan", null)).toEqual({ kind: "discard" });
  });
});

describe("progress widget contract", () => {
  function snapshot(status: SubsessionSnapshot["status"]): SubsessionSnapshot {
    return {
      id: "test-session",
      status,
      toolsUsed: ["read /src/example.ts", `grep ${"long-pattern".repeat(20)}`],
      usage: { input: 2000, output: 1000, toolCalls: 2, cost: 0.001 },
    };
  }

  it("publishes usage and tool progress under the requested widget label", () => {
    vi.useFakeTimers();
    const { ctx, ui, tui } = commandContext("/unused");
    renderSnapshotWidget(ctx, "documenter", snapshot("running"));
    const [label, factory] = ui.setWidget.mock.calls[0]!;
    expect(label).toBe("documenter");
    if (typeof factory !== "function") throw new Error("Missing progress widget factory");
    const widget = factory(tui, ui.theme);
    try {
      const rendered = text(widget);
      expect(rendered).toContain("documenter (");
      expect(rendered).toContain("tools_used=2");
      expect(rendered).toContain("in=2.0k | out=1.0k | cost=$0.001");
      expect(rendered).toContain("read /src/example.ts");
      expect(widget.render(40).every((line) => visibleWidth(line) <= 40)).toBe(true);
    } finally {
      widget.dispose?.();
    }
  });

  it("animates running progress and stops timers when Pi disposes the widget", () => {
    vi.useFakeTimers();
    const { ctx, ui, tui } = commandContext("/unused");
    renderSnapshotWidget(ctx, "planner", snapshot("running"));
    const factory = ui.setWidget.mock.calls[0]?.[1];
    if (typeof factory !== "function") throw new Error("Missing progress widget factory");
    const widget = factory(tui, ui.theme);
    try {
      vi.mocked(tui.requestRender).mockClear();
      vi.advanceTimersByTime(1000);
      expect(tui.requestRender).toHaveBeenCalled();
    } finally {
      widget.dispose?.();
    }
    vi.mocked(tui.requestRender).mockClear();
    vi.advanceTimersByTime(1000);
    expect(tui.requestRender).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["done", "error", "aborted"] as const)(
    "uses a static indicator for %s progress",
    (status) => {
      vi.useFakeTimers();
      const { ctx, ui, tui } = commandContext("/unused");
      renderSnapshotWidget(ctx, "planner", snapshot(status));
      const factory = ui.setWidget.mock.calls[0]?.[1];
      if (typeof factory !== "function") throw new Error("Missing progress widget factory");
      const widget = factory(tui, ui.theme);
      try {
        const before = text(widget);
        expect(before).toContain("•");
        vi.advanceTimersByTime(1000);
        expect(text(widget)).toBe(before);
      } finally {
        widget.dispose?.();
      }
    },
  );
});
