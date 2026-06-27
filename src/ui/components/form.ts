import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, type Focusable, type TUI } from "@earendil-works/pi-tui";
import { FormField } from "./form-field.js";
import { Frame } from "./frame.js";
import { Lines } from "./lines.js";

export type FieldDefinition = {
  key: string;
  placeholder: string;
  label?: string;
  initialText?: string;
  labelWidth?: number;
};

export type FormConfig<TSubmit = Record<string, string>> = {
  title: string;
  fields: FieldDefinition[];
  emptyMessage?: string;
  parseOnSave?: (values: Record<string, string>) => TSubmit;
};

export class Form<TSubmit = Record<string, string>> extends Frame implements Focusable {
  onCancel?: () => void;
  onSave?: (values: TSubmit) => Promise<void> | void;
  onSaveError?: (error: unknown) => void;

  private readonly fields: FormField[];
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
    this.keys = config.fields.map((definition) => definition.key);
    this.fields = config.fields.map((definition) => {
      const option = new FormField(tui, keybindings, theme, {
        label: definition.label ?? definition.key,
        labelWidth: definition.labelWidth,
        mode: { type: "input", placeholder: definition.placeholder, text: definition.initialText },
      });

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

  override getHints(): [string, string][] {
    if (this.editing) {
      return [
        ["Enter", "finish editing"],
        ["Esc", "cancel editing"],
      ];
    }

    return [
      ["↑↓", "navigate"],
      ["Enter", "edit field"],
      ["Ctrl+S", "save"],
      ["Esc", "cancel"],
    ];
  }

  protected override children(width: number): string[] {
    const lines = new Lines(width);
    lines.add(this.theme.bold(this.title));
    lines.space();

    if (this.fields.length === 0) {
      lines.add(this.theme.fg("warning", this.emptyMessage));
      return lines.get();
    }

    for (let idx = 0; idx < this.fields.length; idx++) {
      const field = this.fields[idx]!;
      const isSelected = idx === this.cursor;
      field.highlighted = isSelected;

      const marker = isSelected ? this.theme.fg("accent", "→") : " ";
      const rendered = field.render(width - 2);
      lines.add(`${marker} ${rendered[0] ?? ""}`);
    }

    return lines.get();
  }

  handleInput(data: string) {
    const selectedField = this.fields[this.cursor];

    if (this.editing && selectedField) {
      selectedField.handleInput(data);
      return;
    }
    if (matchesKey(data, Key.escape)) {
      this.onCancel?.();
      return;
    }
    if (matchesKey(data, Key.ctrl("s"))) {
      void this.save();
      return;
    }
    if (!selectedField) {
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.cursor = Math.max(0, this.cursor - 1);
      this.syncFocus();
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.cursor = Math.min(this.fields.length - 1, this.cursor + 1);
      this.syncFocus();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      this.editing = true;
      selectedField.startEditing();
      this.syncFocus();
    }
  }

  private syncFocus() {
    for (let idx = 0; idx < this.fields.length; idx++) {
      const field = this.fields[idx]!;
      field.focused = this._focused && this.editing && idx === this.cursor;
    }
  }

  private serializeValues(): Record<string, string> {
    const values: Record<string, string> = {};
    for (let idx = 0; idx < this.fields.length; idx++) {
      const field = this.fields[idx]!;
      const key = this.keys[idx];
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
