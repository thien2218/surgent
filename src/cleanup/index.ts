import { SessionManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { cleanupPermissions } from "./permission.js";
import { cleanupCheckpointStashes } from "./stash.js";
import { pruneSessionFile } from "./helpers.js";
import { cleanupSubsessions } from "./subsession.js";
import { getPiPath } from "../utils.js";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const [sessions, subsessions] = await Promise.all([
      SessionManager.list(ctx.cwd),
      SessionManager.list(ctx.cwd, getPiPath("subsessionsDir")),
    ]);
    const sessionIds = new Set(sessions.map((session) => session.id));
    const allSessionIds = new Set([...sessionIds, ...subsessions.map((session) => session.id)]);

    cleanupPermissions(ctx.cwd, allSessionIds).catch(() => undefined);
    pruneSessionFile(getPiPath("checkpoints", ctx.cwd), allSessionIds).catch(() => undefined);
    pruneSessionFile(getPiPath("sessionAgents", ctx.cwd), allSessionIds).catch(() => undefined);
    cleanupCheckpointStashes(pi, ctx.cwd, allSessionIds).catch(() => undefined);
    cleanupSubsessions(ctx.cwd, sessionIds).catch(() => undefined);
  });
}
