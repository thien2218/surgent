import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey } from "@earendil-works/pi-tui";
import type { Category, DisplayRule, FileAccess, PermissionRule } from "./types.js";
import { getRulesForDisplay, addRules, readRules, writeRules } from "./storage.js";
import PermissionRulesList from "./components/rules-list.js";
import { Frame } from "../ui/components/frame.js";
import { FormField } from "../ui/components/form-field.js";
import {
  formatRuleOptionLabel,
  getRulePatternPlaceholder,
  cycleRuleScope,
  cycleRuleValue,
} from "./helpers.js";

function notifyError(ctx: ExtensionContext, error: unknown, done?: () => void) {
  const message = error instanceof Error ? error.message : String(error);
  ctx.ui.notify(`Failed to save permission rules: ${message}`, "error");
  done?.();
}

export async function handlePermissionsCommand(ctx: ExtensionCommandContext) {
  if (!ctx.hasUI) {
    ctx.ui.notify("The /permissions command requires an interactive UI.", "error");
    return;
  }

  const sessionId = ctx.sessionManager.getSessionId();
  while (true) {
    const rules = await getRulesForDisplay(ctx.cwd, sessionId);
    const action = await ctx.ui.custom<"exit" | "add">((tui, theme, keybindings, done) => {
      const component = new PermissionRulesList(tui, keybindings, theme, ctx.cwd, sessionId, rules);
      component.onDone = done;
      component.onSaveErr = (error) => notifyError(ctx, error);
      return component;
    });
    if (action !== "add") break;

    const categoryLabel = await ctx.ui.select("Category", ["File", "Web", "Bash", "MCP"]);
    if (!categoryLabel) continue;

    const category = categoryLabel.toLowerCase() as Category;
    const defaultValue: FileAccess | boolean = category === "file" ? "read" : true;
    const toAdd: DisplayRule = { pattern: "", value: defaultValue, scope: "session", category };

    await ctx.ui.custom<void>((tui, theme, keybindings, done) => {
      const frame = new Frame(theme);
      const option = new FormField(tui, keybindings, theme, {
        key: "pattern",
        label: formatRuleOptionLabel(toAdd.scope, toAdd.value),
        mode: {
          type: "input",
          placeholder: getRulePatternPlaceholder(category),
          startEditing: true,
        },
      });

      option.focused = true;
      option.onInputSubmit = (inputValue) => {
        const nextPattern = inputValue.trim();
        if (!nextPattern) return false;

        const rules = new Map([[nextPattern, toAdd.value]]);
        void addRules(ctx.cwd, sessionId, toAdd.scope, category, rules)
          .then(done)
          .catch((error) => notifyError(ctx, error, done));
        return true;
      };
      option.onInputCancel = done;
      frame.addCustom(option);

      return {
        render: (width) => frame.render(width),
        invalidate: () => {
          frame.invalidate();
          option.invalidate();
        },
        handleInput: (data: string) => {
          if (matchesKey(data, Key.shift("tab"))) {
            cycleRuleScope(toAdd);
            option.setLabel(formatRuleOptionLabel(toAdd.scope, toAdd.value));
            return;
          }
          if (matchesKey(data, Key.tab)) {
            cycleRuleValue(toAdd);
            option.setLabel(formatRuleOptionLabel(toAdd.scope, toAdd.value));
            return;
          }
          option.handleInput(data);
        },
      };
    });
  }
}
