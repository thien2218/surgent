import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { cleanupPermissions } from "./permission.js";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    cleanupPermissions(ctx.cwd);
  });
}
