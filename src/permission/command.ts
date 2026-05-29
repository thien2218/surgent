import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Category } from "./types.js";

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

  const categoryLabel = await ctx.ui.select("Permissions", ["File", "Web", "Bash"]);
  if (!categoryLabel) return;

  const category: Category = categoryLabel.toLowerCase() as Category;
}
