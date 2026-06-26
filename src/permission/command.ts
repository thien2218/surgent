import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey } from "@earendil-works/pi-tui";
import type { Category, DisplayRule, FileAccess, PermissionRule } from "./types.js";
import { getRulesForDisplay, addRule, readRules, writeRules } from "./storage.js";
import PermissionRulesList from "./components/rules-list.js";
import { Frame } from "../ui/components/frame.js";
import { EditableOption } from "../ui/components/editable-option.js";
import {
  formatRuleOptionLabel,
  getRuleExprPlaceholder,
  cycleRuleScope,
  cycleRuleValue,
} from "./helpers.js";

async function persistRules(
  ctx: ExtensionCommandContext,
  sessionId: string,
  data: { session: PermissionRule; project: PermissionRule; global: PermissionRule },
): Promise<void> {
  const local = await readRules(ctx.cwd);
  local[sessionId] = data.session;
  local.project = data.project;

  if (Object.keys(data.session).length > 0 || Object.keys(data.project).length > 0) {
    await writeRules(local, ctx.cwd);
  }
  if (Object.keys(data.global).length > 0) {
    await writeRules(data.global);
  }
}

function notifyError(ctx: ExtensionContext, error: unknown, done?: () => void) {
  const message = error instanceof Error ? error.message : String(error);
  ctx.ui.notify(`Failed to save permission rule: ${message}`, "error");
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
      const component = new PermissionRulesList(tui, keybindings, theme, rules);
      component.onDone = done;
      component.onSave = async (data) => persistRules(ctx, sessionId, data);
      component.onSaveErr = (error) => notifyError(ctx, error);
      return component;
    });
    if (action !== "add") break;

    const categoryLabel = await ctx.ui.select("Category", ["File", "Web", "Bash"]);
    if (!categoryLabel) continue;

    const category = categoryLabel.toLowerCase() as Category;
    const defaultValue: FileAccess | boolean = category === "file" ? "read" : true;
    const toAdd: DisplayRule = { expr: "", value: defaultValue, scope: "session", category };

    await ctx.ui.custom<void>((tui, theme, keybindings, done) => {
      const frame = new Frame(theme);
      const option = new EditableOption(tui, keybindings, theme, {
        label: formatRuleOptionLabel(toAdd.scope, toAdd.value),
        mode: { type: "input", placeholder: getRuleExprPlaceholder(category), startEditing: true },
      });

      option.focused = true;
      option.onInputSubmit = (inputValue) => {
        const nextExpr = inputValue.trim();
        if (!nextExpr) return false;

        toAdd.expr = nextExpr;
        addRule(ctx.cwd, sessionId, toAdd.scope, category, toAdd.expr, toAdd.value)
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
