import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { Key, type Focusable, type TUI } from "@earendil-works/pi-tui";
import type {
  Category,
  DisplayRule,
  FileAccess,
  GroupedDisplayRules,
  PermissionRule,
} from "../types.js";
import { Frame } from "../../ui/components/frame.js";
import { Lines } from "../../ui/components/lines.js";
import { FormField } from "../../ui/components/form-field.js";
import { CATEGORIES } from "../constants.js";
import {
  cycleRuleScope,
  cycleRuleValue,
  formatRuleOptionLabel,
  getRuleExprPlaceholder,
} from "../helpers.js";

type RuleOptionEntry = {
  rule: DisplayRule;
  option: FormField;
  deleted: boolean;
};

export default class PermissionRulesList extends Frame implements Focusable {
  private cursor = 0;
  private escapeCount = 0;
  private _focused = false;
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

    this.registerKeybindings([
      {
        key: Key.escape,
        hint: "exit",
        handler: () => {
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
        },
      },
      {
        key: Key.ctrl("s"),
        hint: "save",
        handler: () => {
          if (!this.saved) this.save().catch(this.onSaveErr);
        },
      },
      {
        key: { navigation: "vertical" },
        hint: "navigate",
        navigate: (keyId) => {
          if (keyId === Key.up) {
            this.cursor = Math.max(0, this.cursor - 1);
          } else {
            this.cursor = Math.min(this.getTotalRules(), this.cursor + 1);
          }
          this.setHint(Key.enter, this.cursor === 0 ? "select" : "edit");
        },
      },
      {
        key: Key.ctrl("d"),
        hint: "delete",
        handler: () => {
          const selectedEntry = this.getSelectedRule();
          if (!selectedEntry) return;

          selectedEntry.deleted = true;
          this.saved = false;
          this.cursor = Math.min(this.cursor, this.getTotalRules());
        },
      },
      {
        key: Key.enter,
        hint: "select",
        handler: () => {
          if (this.cursor === 0) {
            if (this.saved) {
              this.onDone?.("add");
            } else {
              this.save()
                .then(() => this.onDone?.("add"))
                .catch(this.onSaveErr);
            }
            return;
          }

          const selectedEntry = this.getSelectedRule();
          if (!selectedEntry) return;
          selectedEntry.option.startEditing();
          this.setEditing(true);
        },
      },
      {
        key: Key.tab,
        hint: "cycle permission",
        handler: () => {
          const selectedEntry = this.getSelectedRule();
          selectedEntry && this.cycleScope(selectedEntry);
        },
      },
      {
        key: Key.shift("tab"),
        hint: "cycle scope",
        handler: () => {
          const selectedEntry = this.getSelectedRule();
          selectedEntry && this.cyclePermission(selectedEntry);
        },
      },
    ]);
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

  private setEditing(value: boolean) {
    this.setHint(Key.enter, value ? "finish editing" : "edit");
    this.setHint(Key.escape, value ? "cancel editing" : "cancel");

    this.setArrowKeyAccess({ navigation: "vertical" }, !value);
    this.setKeyAccess(Key.enter, { consumable: !value });
    this.setKeyAccess(Key.escape, { consumable: !value });
    this.setKeyAccess(Key.ctrl("d"), !value);
    this.setKeyAccess(Key.ctrl("s"), !value);
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
    const addText = `${addSelected ? "→" : " "} [Add new permission rule]`;
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

  handleInput(data: string) {
    if (this.handleKb(data)) return;
    const entry = this.getSelectedRule();
    entry?.option.handleInput(data);
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
    const option = new FormField(tui, keybindings, theme, {
      key: "expr",
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

      this.setEditing(false);
      return true;
    };

    option.onInputCancel = () => {
      option.setText(optionEntry.rule.expr);
      this.setEditing(false);
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
