import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, type Focusable, type TUI } from "@earendil-works/pi-tui";
import type { AgentAllowList, AgentMeta } from "./types.js";
import { Frame } from "../ui/components/frame.js";
import { Lines } from "../ui/components/lines.js";
import { EditableOption } from "../ui/components/editable-option.js";

const ALLOW_LIST_KEYS = new Set<keyof AgentMeta>([
  "tools",
  "mcp_servers",
  "skills",
  "bash",
  "files",
]);

const META_FIELDS: (keyof AgentMeta)[] = ["description", "model", ...ALLOW_LIST_KEYS];

type AgentMetaField = {
  key: keyof AgentMeta;
  option: EditableOption;
  value: string;
};

function parseAllowListInput(value: string): AgentAllowList | undefined {
  const normalizedValue = value.trim();
  if (!normalizedValue) return undefined;
  if (normalizedValue === "none") return "none";

  const entries = normalizedValue
    .split(",")
    .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);

  return entries.length > 0 ? entries : undefined;
}

function parseMetaFields(fields: AgentMetaField[]): AgentMeta {
  const updated: Partial<AgentMeta> = {};

  for (const field of fields) {
    if (ALLOW_LIST_KEYS.has(field.key)) {
      const allowList = parseAllowListInput(field.value);
      if (allowList !== undefined) {
        (updated as Record<string, AgentAllowList>)[field.key] = allowList;
      }
      continue;
    } else {
      const value = field.value.trim();
      if (value) {
        updated[field.key as "description" | "model"] = value;
      }
    }
  }

  if (!updated.description) {
    throw new Error("Description cannot be empty.");
  }

  return updated as AgentMeta;
}

function getMetaPlaceholder(field: keyof AgentMeta): string {
  if (field === "description") {
    return "Describe what this agent does (not included in system prompt)";
  }
  if (field === "model") {
    return "AI model to use for this agent (blank inherits from session)";
  }
  return `Comma-separated allowed ${field}, or none`;
}

export class AgentConfigEditor extends Frame implements Focusable {
  private readonly fields: AgentMetaField[];

  private cursorIndex = 0;
  private editing = false;
  private saving = false;
  private _focused = false;

  onCancel?: () => void;
  onSave?: (meta: AgentMeta) => Promise<void> | void;
  onSaveError?: (error: unknown) => void;

  constructor(
    tui: TUI,
    keybindings: KeybindingsManager,
    theme: Theme,
    private readonly agent: string,
    meta: AgentMeta,
  ) {
    super(theme);

    this.fields = META_FIELDS.map((key) => {
      const initialValue = Array.isArray(meta[key]) ? meta[key].join(", ") : meta[key];
      const option = new EditableOption(tui, keybindings, theme, {
        label: key,
        labelWidth: 32,
        mode: { type: "input", placeholder: getMetaPlaceholder(key), text: initialValue },
      });

      const field: AgentMetaField = { key, option, value: initialValue ?? "" };

      option.onInputSubmit = (inputValue) => {
        field.value = inputValue;
        field.option.setText(inputValue);
        this.editing = false;
        this.syncFocus();
        return true;
      };

      option.onInputCancel = () => {
        field.option.setText(field.value);
        this.editing = false;
        this.syncFocus();
      };

      return field;
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
      field.option.invalidate();
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
    lines.add(this.theme.bold(`Edit agent config: ${this.agent}`));
    lines.space();

    if (this.fields.length === 0) {
      lines.add(this.theme.fg("warning", "No metadata fields available for editing."));
      return lines.get();
    }

    for (let fieldIndex = 0; fieldIndex < this.fields.length; fieldIndex += 1) {
      const field = this.fields[fieldIndex]!;
      const isSelected = fieldIndex === this.cursorIndex;
      field.option.highlighted = isSelected;

      const marker = isSelected ? this.theme.fg("accent", "→") : " ";
      const rendered = field.option.render(width - 2);
      lines.add(`${marker} ${rendered[0] ?? ""}`);
    }

    return lines.get();
  }

  handleInput(data: string) {
    const selected = this.fields[this.cursorIndex];

    if (this.editing && selected) {
      selected.option.handleInput(data);
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
    if (!selected) {
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.cursorIndex = Math.max(0, this.cursorIndex - 1);
      this.syncFocus();
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.cursorIndex = Math.min(this.fields.length - 1, this.cursorIndex + 1);
      this.syncFocus();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      this.editing = true;
      selected.option.startEditing();
      this.syncFocus();
    }
  }

  private syncFocus() {
    for (let fieldIndex = 0; fieldIndex < this.fields.length; fieldIndex += 1) {
      const field = this.fields[fieldIndex]!;
      field.option.focused = this._focused && this.editing && fieldIndex === this.cursorIndex;
    }
  }

  private async save() {
    if (this.saving) return;
    this.saving = true;
    try {
      const parsedMeta = parseMetaFields(this.fields);
      await this.onSave?.(parsedMeta);
    } catch (error) {
      this.onSaveError?.(error);
    } finally {
      this.saving = false;
    }
  }
}
