/**
 * Temporary extension for manual UI component testing.
 * Register a /test command here and remove this directory when done.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import PermissionPrompt from "../permission/components/prompt.js";
import type { PermCheck, PromptDecision } from "../permission/types.js";

const permCheck: PermCheck = {
  toolName: "bash",
  category: "bash",
  raw: "npm install express",
};

export default function tempExtension(pi: ExtensionAPI) {
  pi.registerCommand("test", {
    description: "Test PermissionPrompt component",
    handler: async (_args, ctx) => {
      const decision = await ctx.ui.custom<PromptDecision>((t_ui, theme, _kb, done) => {
        const component = new PermissionPrompt(theme, "npm install *", permCheck, false);
        component.onDone = done;
        component.onStoreRule = (scope, category, expr, value) => {
          ctx.ui.notify(`Store rule: ${scope} / ${category} / ${expr} = ${String(value)}`, "info");
        };
        return component;
      });

      if (!decision) {
        ctx.ui.notify("Dismissed", "info");
      } else {
        ctx.ui.notify(
          `Decision: allowed=${decision.allowed}${decision.amended ? ` amended="${decision.amended}"` : ""}`,
          decision.allowed ? "info" : "error",
        );
      }
    },
  });
}
