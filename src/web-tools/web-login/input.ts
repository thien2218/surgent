import type { Theme } from "@earendil-works/pi-coding-agent";
import { Input, Key, type Focusable, type TUI } from "@earendil-works/pi-tui";
import { Frame } from "../../ui/components/frame.js";
import { Lines } from "../../ui/components/lines.js";

export class SecretInput extends Frame implements Focusable {
  private readonly input: Input;
  onDone?: (value: string | undefined) => void;

  constructor(
    private readonly tui: TUI,
    theme: Theme,
    private readonly title: string,
    placeholder: string,
  ) {
    super(theme);
    this.input = new Input({ placeholder });
    this.input.onSubmit = (value) => this.onDone?.(value);
    this.input.onEscape = () => this.onDone?.(undefined);
    this.registerKeybindings([
      { key: Key.enter, hint: "save", handler: () => this.onDone?.(this.input.getValue()) },
      { key: Key.escape, hint: "cancel", handler: () => this.onDone?.(undefined) },
    ]);
  }

  get focused() {
    return this.input.focused;
  }

  set focused(value: boolean) {
    this.input.focused = value;
  }

  override invalidate() {
    super.invalidate();
    this.input.invalidate();
  }

  protected override children(width: number): string[] {
    const lines = new Lines(width);
    const value = this.input.getValue();
    this.input.setValue(`${value.slice(0, 5)}${"*".repeat(value.length - 5)}`);

    lines.add(this.theme.fg("accent", this.title));
    lines.space();
    lines.add(this.input.render(width)[0]!);

    this.input.setValue(value);
    return lines.get();
  }

  handleInput(data: string) {
    if (!this.handleKb(data)) this.input.handleInput(data);
    this.tui.requestRender();
  }
}
