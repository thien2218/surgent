import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Category, DisplayRule, FileAccess } from "./types.js";
import { getRulesForDisplay, addRule, readLocal, writeLocal, writeGlobal } from "./storage.js";
import PermissionRulesList from "./components/rules-list.js";
import EditableOption from "./components/editable-option.js";
import { Frame } from "../ui/components/frame.js";

export function getSessionId(sessionManager: ExtensionCommandContext["sessionManager"]) {
  const branch = sessionManager.getBranch();
  return branch[0]?.id ?? sessionManager.getLeafId();
}

export async function handlePermissionsCommand(ctx: ExtensionCommandContext): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("The /permissions command requires an interactive UI.", "error");
    return;
  }

  const sessionId = getSessionId(ctx.sessionManager);
  if (!sessionId) return;
  const rules = await getRulesForDisplay(ctx.cwd, sessionId);

  while (true) {
    const action = await ctx.ui.custom<"save" | "exit" | "add">((_tui, theme, _kb, done) => {
      const component = new PermissionRulesList(theme, rules);
      component.onDone = done;
      component.onSave = (data) => {
        readLocal(ctx.cwd).then((local) => {
          local[sessionId] = data.session;
          local.project = data.project;
          return writeLocal(ctx.cwd, local);
        });
        writeGlobal(data.global);
      };
      return component;
    });

    if (action !== "add") break;

    const categoryLabel = await ctx.ui.select("Category", ["File", "Web", "Bash"]);
    if (!categoryLabel) continue;

    const category = categoryLabel.toLowerCase() as Category;
    const defaultValue: FileAccess | boolean = category === "file" ? "read" : true;
    const newRule: DisplayRule = { expr: "", value: defaultValue, scope: "session" };

    await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
      const frame = new Frame(theme);
      const opt = new EditableOption(theme, newRule, true);

      opt.focused = true;
      opt.onChange = (rule) => {
        addRule(ctx.cwd, sessionId, rule.scope, category, rule.expr, rule.value);
        done();
      };
      opt.onCancel = done;
      frame.addCustom(opt);

      return {
        render: (w) => frame.render(w),
        invalidate: () => {
          frame.invalidate();
          opt.invalidate();
        },
        handleInput: (data: string) => opt.handleInput(data),
      };
    });
  }
}
