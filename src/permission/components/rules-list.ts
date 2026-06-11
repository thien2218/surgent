import { Key, matchesKey, type Focusable } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Category, FileAccess, GroupedDisplayRules, PermissionRule } from "../types.js";
import { Frame } from "../../ui/components/frame.js";
import { Lines } from "../../ui/components/lines.js";
import { CATEGORIES } from "../constants.js";
import EditableOption from "./editable-option.js";

export default class PermissionRulesList extends Frame implements Focusable {
  private cursor = 0;
  private escapeCount = 0;
  private _focused = false;
  private editing = false;
  private saved = true;
  private readonly editableOptions = new Map<Category, EditableOption[]>();

  onDone?: (action: "exit" | "add") => void;
  onSave?: (data: {
    session: PermissionRule;
    project: PermissionRule;
    global: PermissionRule;
  }) => void;

  constructor(
    protected theme: Theme,
    groups: GroupedDisplayRules,
  ) {
    super(theme);

    for (const [group, rules] of Object.entries(groups)) {
      const options = rules.map((rule) => {
        const option = new EditableOption(theme, rule);
        option.onChange = () => {
          this.saved = false;
          this.editing = false;
        };
        option.onCancel = () => (this.editing = false);
        return option;
      });
      this.editableOptions.set(group as Category, options);
    }
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    const editingRule = this.getEditingRule();
    if (editingRule) {
      editingRule.focused = value;
    }
  }

  override invalidate(): void {
    super.invalidate();
    for (const options of this.editableOptions.values()) {
      for (const option of options) {
        option.invalidate();
      }
    }
  }

  protected override children(width: number): string[] {
    const lines = new Lines(width);
    const unsavedWarning = this.theme.fg("warning", !this.saved ? " (unsaved)" : "");

    lines.add(this.theme.bold("All permission rules") + unsavedWarning);
    lines.space();

    const addSelected = this.cursor === 0;
    const addText = `${addSelected ? "→" : " "} Add a new permission rule`;
    lines.add(this.theme.fg(addSelected ? "accent" : "text", addText));

    let orderedIdx = 0;
    for (const category of CATEGORIES) {
      const options = this.editableOptions.get(category)!;
      if (options.length === 0) continue;

      lines.space();
      lines.add(this.theme.fg("muted", `[${category}]`), 2);

      for (const option of options) {
        const isSelected = this.cursor === orderedIdx + 1;
        const prefix = isSelected ? this.theme.fg("accent", "→") : " ";
        option.highlighted = isSelected;
        // 4 chars overhead (2 pad + 2 prefix)
        const line = `${prefix} ${option.render(width - 4)[0]!}`;
        lines.add(line, 2);
        orderedIdx++;
      }
    }

    if (this.escapeCount === 1) {
      lines.space();
      lines.add(this.theme.fg("warning", "Press Esc/Ctrl+C again to exit without saving."), 1);
    }

    return lines.get();
  }

  override getHints(): [string, string][] {
    if (this.editing) {
      return [
        ["Enter", "finish editing"],
        ["Esc", "cancel editing"],
        ["Tab", "cycle permission"],
        ["Shift+Tab", "cycle scope"],
      ];
    }
    return [
      ["↑↓", "navigate"],
      ["Enter", "select/edit"],
      ["Ctrl+D", "delete"],
      ["Ctrl+S", "save"],
      ["Esc", "exit"],
    ];
  }

  handleInput(data: string): void {
    const opt = this.getEditingRule();

    if (this.editing && opt) {
      opt.handleInput(data);
      return;
    }

    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      if (this.saved) {
        this.onDone?.("exit");
      }

      this.escapeCount++;
      const timeout = setTimeout(() => {
        this.escapeCount = 0;
      }, 1000);

      if (this.escapeCount >= 2) {
        clearTimeout(timeout);
        this.onDone?.("exit");
      }
      return;
    }

    if (!this.saved && matchesKey(data, Key.ctrl("s"))) {
      this.save();
      return;
    }

    if (matchesKey(data, Key.up)) {
      this.cursor = Math.max(0, this.cursor - 1);
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.cursor = Math.min(this.getTotalRules(), this.cursor + 1);
      return;
    }

    if (matchesKey(data, Key.enter) && this.cursor === 0) {
      this.save();
      this.onDone?.("add");
      return;
    }

    if (!opt) return;

    if (matchesKey(data, Key.ctrl("d"))) {
      opt.deleted = true;
      this.cursor = Math.min(this.cursor, this.getTotalRules());
      return;
    }

    if (matchesKey(data, Key.enter)) {
      opt.startEditing();
      this.editing = true;
      return;
    }
  }

  private save(): void {
    const global: PermissionRule = {};
    const session: PermissionRule = {};
    const project: PermissionRule = {};

    for (const [category, options] of this.editableOptions.entries()) {
      for (const option of options) {
        if (option.deleted) continue;
        const rule = option.getRule();

        let target: PermissionRule;
        if (rule.scope === "always") target = global;
        else if (rule.scope === "project") target = project;
        else target = session;

        if (category === "file") {
          target.file = { ...target.file, [rule.expr]: rule.value as FileAccess };
        } else if (category === "web") {
          target.web = { ...target.web, [rule.expr]: rule.value as boolean };
        } else {
          target.bash = { ...target.bash, [rule.expr]: rule.value as boolean };
        }
      }
    }

    const data = { session, project, global };
    this.saved = true;
    this.onSave?.(data);
  }

  private getEditingRule() {
    let len = 1;
    for (const category of CATEGORIES) {
      const options = this.editableOptions.get(category)!.filter((opt) => !opt.deleted);
      if (this.cursor >= len + options.length) {
        len += options.length;
        continue;
      }
      return this.editableOptions.get(category)![this.cursor - len];
    }
  }

  private getTotalRules() {
    let len = 0;
    for (const category of CATEGORIES) {
      const options = this.editableOptions.get(category)!.filter((opt) => !opt.deleted);
      len += options.length;
    }
    return len;
  }
}
