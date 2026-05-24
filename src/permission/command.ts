import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { removeRule, toggleRule } from "./storage.js";
import type { Category, DisplayRule, Scope } from "./types.js";

const SCOPE_LABELS: Record<Scope, string> = {
  session: "current session",
  project: "project",
  always: "always",
};

const SCOPE_ORDER: Scope[] = ["session", "project", "always"];

class RuleListComponent implements Component {
  private cursor = 0;
  private cachedLines: string[] | undefined;
  onDone?: () => void;
  onToggle?: (rule: DisplayRule) => Promise<void>;
  onDelete?: (rule: DisplayRule) => Promise<void>;

  constructor(
    private rules: DisplayRule[],
    private readonly tui: { requestRender(): void },
    private readonly theme: { fg(role: string, text: string): string; bold(text: string): string },
    private readonly category: Category,
  ) {}

  updateRules(rules: DisplayRule[]): void {
    this.rules = rules;
    if (this.cursor >= rules.length) this.cursor = Math.max(0, rules.length - 1);
    this.invalidate();
  }

  invalidate(): void {
    this.cachedLines = undefined;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.onDone?.();
      return;
    }

    if (matchesKey(data, Key.up)) {
      this.cursor = Math.max(0, this.cursor - 1);
      this.invalidate();
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, Key.down)) {
      this.cursor = Math.min(this.rules.length - 1, this.cursor + 1);
      this.invalidate();
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, Key.enter)) {
      const rule = this.rules[this.cursor];
      if (rule) {
        this.onToggle?.(rule).then(() => {
          this.invalidate();
          this.tui.requestRender();
        });
      }
      return;
    }

    if (matchesKey(data, Key.ctrl("d"))) {
      const rule = this.rules[this.cursor];
      if (rule) {
        this.onDelete?.(rule).then(() => {
          this.invalidate();
          this.tui.requestRender();
          if (this.rules.length === 0) this.onDone?.();
        });
      }
      return;
    }
  }

  render(width: number): string[] {
    if (this.cachedLines) return this.cachedLines;
    const { fg, bold } = this.theme;
    const lines: string[] = [];
    const add = (line = "") => lines.push(truncateToWidth(line, width));

    add(fg("accent", `-`.repeat(width)));
    add(` ${bold(this.category.toUpperCase())} permissions`);
    add();

    const sorted = [...this.rules].sort(
      (a, b) => SCOPE_ORDER.indexOf(a.scope) - SCOPE_ORDER.indexOf(b.scope),
    );

    let lastScope: Scope | undefined;
    for (const [i, rule] of sorted.entries()) {
      const origIdx = this.rules.indexOf(rule);
      if (rule.scope !== lastScope) {
        if (lastScope !== undefined) add();
        add(fg("muted", `  [${SCOPE_LABELS[rule.scope]}]`));
        lastScope = rule.scope;
      }
      const valueStr = formatValue(rule.value);
      const line = `    ${rule.key}: ${valueStr}`;
      if (origIdx === this.cursor) {
        add(`> ${fg("accent", bold(line.slice(2)))}`);
      } else {
        add(`  ${fg("muted", line.slice(2))}`);
      }
    }

    add();
    add(fg("dim", `  ↑↓ move • Enter toggle • Ctrl+D delete • Esc back`));
    add(fg("accent", `-`.repeat(width)));

    this.cachedLines = lines;
    return lines;
  }
}

function formatValue(value: boolean | string): string {
  if (value === true) return "allowed";
  if (value === false) return "denied";
  return String(value);
}

let registered = false;
let currentSessionId = "";

export function registerPermissionsCommand(pi: ExtensionAPI, sessionId: string): void {
  currentSessionId = sessionId;
  if (registered) return;
  registered = true;

  pi.registerCommand("permissions", {
    description: "View and manage file, web, and bash permissions",
    handler: async (args, ctx) => {
      const sid = currentSessionId;
      await handlePermissionsCommand(ctx, sid);
    },
  });
}

async function handlePermissionsCommand(
  ctx: ExtensionCommandContext,
  sessionId: string,
): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("The /permissions command requires an interactive UI.", "error");
    return;
  }

  const categoryLabel = await ctx.ui.select("Permissions", ["Files", "Web", "Bash"]);
  if (!categoryLabel) return;

  const category: Category =
    categoryLabel === "Files" ? "files" : categoryLabel === "Web" ? "web" : "bash";

  await showRuleList(ctx, sessionId, category);
}

async function showRuleList(
  ctx: ExtensionCommandContext,
  sessionId: string,
  category: Category,
): Promise<void> {
  const { getRulesForDisplay } = await import("./storage.js");
  const allRules = await getRulesForDisplay(ctx.cwd, sessionId);
  const rules = allRules.filter((r) => r.category === category);

  if (rules.length === 0) {
    ctx.ui.notify(`No ${category} rules configured.`, "info");
    return;
  }

  await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
    const component = new RuleListComponent(rules, tui, theme, category);
    component.onDone = done;

    component.onToggle = async (rule) => {
      await toggleRule(ctx.cwd, rule.scope, sessionId, rule.category, rule.key);
      const updated = await getRulesForDisplay(ctx.cwd, sessionId);
      component.updateRules(updated.filter((r) => r.category === category));
    };

    component.onDelete = async (rule) => {
      await removeRule(ctx.cwd, rule.scope, sessionId, rule.category, rule.key);
      const updated = await getRulesForDisplay(ctx.cwd, sessionId);
      component.updateRules(updated.filter((r) => r.category === category));
    };

    return component;
  });
}
