import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, type Focusable, type TUI } from "@earendil-works/pi-tui";
import type {
  Category,
  DisplayRule,
  FileAccess,
  GroupedDisplayRules,
  PermissionRule,
} from "../types.js";
import { Frame } from "../../ui/components/frame.js";
import { Lines } from "../../ui/components/lines.js";
import { EditableOption } from "../../ui/components/editable-option.js";
import { CATEGORIES } from "../constants.js";
import {
  cycleRuleScope,
  cycleRuleValue,
  formatRuleOptionLabel,
  getRuleExprPlaceholder,
} from "../helpers.js";

type RuleOptionEntry = {
  rule: DisplayRule;
  option: EditableOption;
  deleted: boolean;
};

export default class PermissionRulesList extends Frame implements Focusable {
  private cursor = 0;
  private escapeCount = 0;
  private _focused = false;
  private editing = false;
  private saved = true;
  private readonly options = new Map<Category, RuleOptionEntry[]>();

  onDone?: (action: "exit" | "add") => void;
  onSave?: (data: {
    session: PermissionRule;
    project: PermissionRule;
    global: PermissionRule;
  }) => Promise<void> | void;
  onSaveErr?: (error: unknown) => void;

  constructor(
    tui: TUI,
    keybindings: KeybindingsManager,
    protected theme: Theme,
    groups: GroupedDisplayRules,
  ) {
    super(theme);

    for (const [group, rules] of Object.entries(groups)) {
      const category = group as Category;
      const options = rules.map((rule) =>
        this.createRuleOption(tui, keybindings, theme, category, rule),
      );
      this.options.set(category, options);
    }
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    const selectedEntry = this.getSelectedRule();
    if (selectedEntry) {
      selectedEntry.option.focused = value;
    }
  }

  override invalidate() {
    super.invalidate();
    for (const options of this.options.values()) {
      for (const option of options) {
        option.option.invalidate();
      }
    }
  }

  protected override children(width: number): string[] {
    const lines = new Lines(width);
    const unsavedWarning = this.theme.fg("warning", !this.saved ? " (unsaved)" : "");

    lines.add(this.theme.bold("All permission rules") + this.theme.fg("warning", unsavedWarning));
    lines.space();

    const addSelected = this.cursor === 0;
    const addText = `${addSelected ? "→" : " "} [Add a new permission rule]`;
    lines.add(this.theme.fg(addSelected ? "accent" : "text", addText));

    let orderedIndex = 1;
    for (const category of CATEGORIES) {
      const visibleEntries = this.getOptionsForCategory(category);
      if (visibleEntries.length === 0) continue;

      lines.space();
      lines.add(this.theme.fg("muted", category), 2);

      for (const entry of visibleEntries) {
        const isSelected = this.cursor === orderedIndex;
        const prefix = isSelected ? this.theme.fg("accent", "→") : " ";
        entry.option.highlighted = isSelected;

        const renderedOption = entry.option.render(width - 4);
        if (renderedOption.length > 0) {
          lines.add(`${prefix} ${renderedOption[0]!}`, 2);
        }
        orderedIndex++;
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

  handleInput(data: string) {
    const selectedEntry = this.getSelectedRule();
    if (this.editing && selectedEntry) {
      if (matchesKey(data, Key.shift("tab"))) {
        this.cycleScope(selectedEntry);
        return;
      }

      if (matchesKey(data, Key.tab)) {
        this.cyclePermission(selectedEntry);
        return;
      }

      selectedEntry.option.handleInput(data);
      return;
    }

    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      if (this.saved) {
        this.onDone?.("exit");
        return;
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
      this.save().catch(this.onSaveErr);
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
      if (this.saved) {
        this.onDone?.("add");
        return;
      }
      this.save()
        .then(() => this.onDone?.("add"))
        .catch(this.onSaveErr);
      return;
    }

    if (!selectedEntry) return;
    if (matchesKey(data, Key.ctrl("d"))) {
      selectedEntry.deleted = true;
      this.saved = false;
      this.cursor = Math.min(this.cursor, this.getTotalRules());
      return;
    }
    if (matchesKey(data, Key.enter)) {
      selectedEntry.option.startEditing();
      this.editing = true;
      return;
    }
  }

  private async save() {
    const global: PermissionRule = {};
    const session: PermissionRule = {};
    const project: PermissionRule = {};

    for (const [category, options] of this.options.entries()) {
      for (const optionEntry of options) {
        if (optionEntry.deleted) continue;
        const rule = optionEntry.rule;

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
    await this.onSave?.(data);
    this.saved = true;
  }

  private getSelectedRule(): RuleOptionEntry | undefined {
    if (this.cursor === 0) {
      return undefined;
    }
    const visibleOptions = this.getVisibleOptions();
    return visibleOptions[this.cursor - 1];
  }

  private getVisibleOptions(): RuleOptionEntry[] {
    const visibleOptions: RuleOptionEntry[] = [];
    for (const category of CATEGORIES) {
      visibleOptions.push(...this.getOptionsForCategory(category));
    }
    return visibleOptions;
  }

  private getOptionsForCategory(category: Category): RuleOptionEntry[] {
    const options = this.options.get(category) ?? [];
    return options.filter((optionEntry) => !optionEntry.deleted);
  }

  private getTotalRules() {
    return this.getVisibleOptions().length;
  }

  private createRuleOption(
    tui: TUI,
    keybindings: KeybindingsManager,
    theme: Theme,
    category: Category,
    rule: DisplayRule,
  ): RuleOptionEntry {
    const option = new EditableOption(tui, keybindings, theme, {
      label: formatRuleOptionLabel(rule.scope, rule.value),
      mode: { type: "input", placeholder: getRuleExprPlaceholder(category), text: rule.expr },
    });

    const optionEntry: RuleOptionEntry = { rule, option, deleted: false };

    option.onInputSubmit = (inputValue) => {
      const inputExpr = inputValue.trim();
      const nextExpr = inputExpr || optionEntry.rule.expr.trim();
      if (!nextExpr) {
        return false;
      }

      if (nextExpr !== optionEntry.rule.expr) {
        optionEntry.rule.expr = nextExpr;
        option.setText(nextExpr);
        this.saved = false;
      }

      this.editing = false;
      return true;
    };

    option.onInputCancel = () => {
      option.setText(optionEntry.rule.expr);
      this.editing = false;
    };

    return optionEntry;
  }

  private cycleScope(optionEntry: RuleOptionEntry) {
    cycleRuleScope(optionEntry.rule);
    optionEntry.option.setLabel(
      formatRuleOptionLabel(optionEntry.rule.scope, optionEntry.rule.value),
    );
    this.saved = false;
  }

  private cyclePermission(optionEntry: RuleOptionEntry) {
    cycleRuleValue(optionEntry.rule);
    optionEntry.option.setLabel(
      formatRuleOptionLabel(optionEntry.rule.scope, optionEntry.rule.value),
    );
    this.saved = false;
  }
}
