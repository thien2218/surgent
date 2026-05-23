import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { rawKeyHint } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

const SCROLL_KEY = Key.ctrl("end");

function buildHint(theme: Theme): string {
  return theme.bg(
    "toolPendingBg",
    theme.fg("dim", ` ${rawKeyHint("ctrl+end", "scroll to bottom")} `),
  );
}

export default function scrollToBottomExtension(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;

    let tui: TUI | undefined;
    let cachedHint: string | undefined;

    ctx.ui.setWidget("scroll-to-bottom-hint", (t, theme) => {
      tui = t;
      cachedHint = buildHint(theme);

      return {
        render(width: number): string[] {
          const maxLines: number =
            (tui as unknown as Record<string, number>)["maxLinesRendered"] ?? 0;
          if (maxLines <= (tui?.terminal.rows ?? 0)) return [];

          const hint = cachedHint ?? "";
          const hintWidth = visibleWidth(hint);
          const padding = Math.max(0, Math.floor((width - hintWidth) / 2));
          return [truncateToWidth(" ".repeat(padding) + hint, width)];
        },
        invalidate(): void {
          cachedHint = buildHint(ctx.ui.theme);
        },
      };
    });

    ctx.ui.onTerminalInput((data) => {
      if (matchesKey(data, SCROLL_KEY)) {
        tui?.requestRender(true);
        return { consume: true };
      }
    });
  });
}
