import { SessionManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { cleanupPermissions } from "./permission.js";
import { cleanupCheckpointStashes } from "./stash.js";
import { pruneSessionFile } from "./helpers.js";
import { cleanupSubsessions } from "./subsession.js";
import { SUBSESSION_DIR_NAME } from "../subsession/index.js";
import { getPiPath } from "../utils.js";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const sessions = await SessionManager.list(ctx.cwd);
    const subsession = await SessionManager.list(ctx.cwd, SUBSESSION_DIR_NAME);
    const sessionIds = new Set(sessions.map((session) => session.id));
    const allSessionIds = new Set([...sessionIds, ...subsession.map((session) => session.id)]);

    cleanupPermissions(ctx.cwd, allSessionIds).catch(() => undefined);
    pruneSessionFile(getPiPath("checkpoints", ctx.cwd), allSessionIds).catch(() => undefined);
    pruneSessionFile(getPiPath("sessionAgents", ctx.cwd), allSessionIds).catch(() => undefined);
    cleanupCheckpointStashes(pi, ctx.cwd, allSessionIds).catch(() => undefined);
    cleanupSubsessions(ctx.cwd, sessionIds).catch(() => undefined);
  });
}
