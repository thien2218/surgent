import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { Key, type Focusable, type TUI } from "@earendil-works/pi-tui";
import { FormField, type Field } from "./form-field.js";
import { Frame } from "./frame.js";
import { Lines } from "./lines.js";

export type FormConfig<TSubmit = Record<string, string>> = {
  title: string;
  fields: Field<string | number | boolean>[];
  emptyMessage?: string;
  parseOnSave?: (values: Record<string, string>) => TSubmit;
};

export class Form<TSubmit = Record<string, string>> extends Frame implements Focusable {
  onCancel?: () => void;
  onSave?: (values: TSubmit) => Promise<void> | void;
  onSaveError?: (error: unknown) => void;

  private readonly fields: FormField<string | number | boolean>[];
  private readonly keys: string[];
  private readonly title: string;
  private readonly emptyMessage: string;
  private readonly parseOnSave?: (values: Record<string, string>) => TSubmit;

  private cursor = 0;
  private editing = false;
  private saving = false;
  private _focused = false;

  constructor(
    tui: TUI,
    keybindings: KeybindingsManager,
    theme: Theme,
    config: FormConfig<TSubmit>,
  ) {
    super(theme);

    this.title = config.title;
    this.emptyMessage = config.emptyMessage ?? "No fields available for editing.";
    this.parseOnSave = config.parseOnSave;
    this.keys = config.fields.map((field) => field.key);
    this.fields = config.fields.map((field) => {
      const option = new FormField<string | number | boolean>(tui, keybindings, theme, field);

      option.onInputSubmit = (inputValue) => {
        option.setText(inputValue);
        this.editing = false;
        this.syncFocus();
        return true;
      };

      option.onInputCancel = () => {
        this.editing = false;
        this.syncFocus();
      };

      return option;
    });

    this.registerKeybindings([
      { key: Key.escape, handler: () => this.onCancel?.() },
      { key: Key.ctrl("s"), hint: "save", handler: () => void this.save() },
      {
        key: { navigation: "vertical" },
        hint: "navigate",
        navigate: (keyId) => {
          if (this.editing) return;
          if (keyId === Key.up) {
            this.cursor = Math.max(0, this.cursor - 1);
          } else {
            this.cursor = Math.min(this.fields.length - 1, this.cursor + 1);
          }
          this.syncFocus();
        },
      },
      {
        key: Key.enter,
        handler: () => {
          const selectedField = this.fields[this.cursor];
          if (!selectedField || this.editing) return;
          if (selectedField.modeType === "toggle") {
            selectedField.handleInput(Key.enter);
            return;
          }

          this.editing = true;
          selectedField.startEditing();
          this.syncFocus();
        },
      },
    ]);

    this.syncFocus();
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.syncFocus();
  }

  override invalidate() {
    super.invalidate();
    for (const field of this.fields) {
      field.invalidate();
    }
  }

  protected override children(width: number): string[] {
    const lines = new Lines(width);
    lines.add(this.theme.bold(this.title));
    lines.space();

    if (this.fields.length === 0) {
      lines.add(this.theme.fg("warning", this.emptyMessage));
      return lines.get();
    }

    for (let index = 0; index < this.fields.length; index++) {
      const field = this.fields[index]!;
      const isSelected = index === this.cursor;
      field.highlighted = isSelected;

      const marker = isSelected ? this.theme.fg("accent", "→") : " ";
      const rendered = field.render(width - 2);
      lines.add(`${marker} ${rendered[0] ?? ""}`);
    }

    return lines.get();
  }

  handleInput(data: string) {
    const selectedField = this.fields[this.cursor];
    if (this.editing && selectedField && selectedField.modeType === "input") {
      selectedField.handleInput(data);
      return;
    }
    this.handleKb(data);
  }

  private syncFocus() {
    this.updateHint("enter", this.editing ? "finish editing" : "edit/toggle");
    this.updateHint("esc", this.editing ? "cancel editing" : "cancel");

    for (let index = 0; index < this.fields.length; index++) {
      const field = this.fields[index]!;
      field.focused = this._focused && this.editing && index === this.cursor;
    }
  }

  private serializeValues(): Record<string, string> {
    const values: Record<string, string> = {};
    for (let index = 0; index < this.fields.length; index++) {
      const field = this.fields[index]!;
      const key = this.keys[index];
      if (key) {
        values[key] = field.getText();
      }
    }
    return values;
  }

  private async save() {
    if (this.saving) return;
    this.saving = true;
    try {
      const serializedValues = this.serializeValues();
      const submitValues = this.parseOnSave
        ? this.parseOnSave(serializedValues)
        : (serializedValues as unknown as TSubmit);

      await this.onSave?.(submitValues);
    } catch (error) {
      this.onSaveError?.(error);
    } finally {
      this.saving = false;
    }
  }
}
