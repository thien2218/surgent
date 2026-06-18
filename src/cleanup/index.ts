import { SessionManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { cleanupPermissions } from "./permission.js";
import { cleanupCheckpointStashes } from "./stash.js";
import { pruneSessionFile } from "./helpers.js";
import { getPiPath } from "../utils.js";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const sessions = await SessionManager.list(ctx.cwd);
    const sessionIds = new Set(sessions.map((session) => session.id));

    cleanupPermissions(ctx.cwd, sessionIds).catch(() => undefined);
    pruneSessionFile(getPiPath("checkpoints", ctx.cwd), sessionIds).catch(() => undefined);
    pruneSessionFile(getPiPath("sessionAgents", ctx.cwd), sessionIds).catch(() => undefined);
    cleanupCheckpointStashes(pi, ctx.cwd, sessionIds).catch(() => undefined);
  });
}
