import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Focusable, Input, Key, matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import { Lines } from "./lines.js";
import { Frame } from "./frame.js";

export type ScopeItem = { label: string; value: string };
export type ScopedInputResult = { scope: string; value: string };

const DEFAULT_SCOPES: ScopeItem[] = [
  { label: "project", value: "project" },
  { label: "global", value: "global" },
];

export class ScopedInput extends Frame implements Focusable {
  private readonly input = new Input();
  private readonly scopes: ScopeItem[];
  private scopeIndex = 0;

  onSubmit?: (result: ScopedInputResult) => void;
  onCancel?: () => void;

  get focused(): boolean {
    return this.input.focused;
  }

  set focused(value: boolean) {
    this.input.focused = value;
  }

  constructor(
    theme: Theme,
    private readonly title: string,
    scopes: ScopeItem[] = DEFAULT_SCOPES,
  ) {
    super(theme);
    this.scopes = scopes;
    this.input.focused = true;

    this.getHints = () => [
      ["shift+tab", "toggle scope"],
      ["enter", "create"],
      ["esc", "cancel"],
    ];
  }

  protected override children(width: number): string[] {
    const lines = new Lines(width - 1);
    lines.add(this.theme.bold(this.title));
    lines.space();
    const prefix = this.theme.fg("muted", `(${this.scopes[this.scopeIndex]!.label})  `);
    const inputLine = this.input.render(width - 1 - visibleWidth(prefix))[0]!.slice(2);
    lines.add(prefix + inputLine);
    return lines.get();
  }

  override invalidate(): void {
    super.invalidate();
    this.input.invalidate();
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.shift("tab"))) {
      this.scopeIndex = (this.scopeIndex + 1) % this.scopes.length;
      return;
    }
    if (matchesKey(data, Key.escape)) {
      this.onCancel?.();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const value = this.input.getValue().trim();
      if (value) this.onSubmit?.({ scope: this.scopes[this.scopeIndex]!.value, value });
      return;
    }
    this.input.handleInput(data);
  }
}
