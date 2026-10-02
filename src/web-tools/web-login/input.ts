import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Input, Text } from "@earendil-works/pi-tui";

export class SecretInput extends Input {
  override render(width: number): string[] {
    const value = this.getValue();
    this.setValue("*".repeat(value.length));
    try {
      return super.render(width);
    } finally {
      this.setValue(value);
    }
  }
}

export async function inputApiKey(
  ctx: ExtensionCommandContext,
  title: string,
  placeholder: string,
) {
  if (!ctx.hasUI) return;
  if (ctx.mode !== "tui") {
    ctx.ui.notify("Masked API key entry requires the interactive TUI.", "warning");
    return;
  }

  return ctx.ui.custom<string | undefined>((tui, theme, _keys, done) => {
    const input = new SecretInput({ placeholder });
    const heading = new Text(theme.fg("accent", title), 0, 0);
    const help = new Text(theme.fg("dim", "enter to save · escape to cancel"), 0, 0);

    input.onSubmit = done;
    input.onEscape = () => done(undefined);

    return {
      get focused() {
        return input.focused;
      },
      set focused(value: boolean) {
        input.focused = value;
      },
      render(width: number) {
        return [...heading.render(width), ...input.render(width), ...help.render(width)];
      },
      handleInput(data: string) {
        input.handleInput(data);
        tui.requestRender();
      },
      invalidate() {
        input.invalidate();
        heading.invalidate();
        help.invalidate();
      },
    };
  });
}
