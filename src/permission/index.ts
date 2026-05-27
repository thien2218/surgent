import type { ExtensionAPI, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { cleanup } from "./cleanup.js";
import { getSessionId, handlePermissionsCommand } from "./command.js";
import { showPermissionPrompt } from "./prompt.js";
import { resolvePermission } from "./resolution.js";
import { addRule } from "./storage.js";
import type { PermCheck } from "./types.js";
import { isYolo } from "../agents/states.js";

function getPermissionCheck(event: ToolCallEvent): PermCheck | null {
  if (isToolCallEventType("read", event)) {
    return { category: "files", key: event.input.path, op: "read" };
  }
  if (isToolCallEventType("write", event)) {
    return { category: "files", key: event.input.path, op: "write" };
  }
  if (isToolCallEventType("edit", event)) {
    return { category: "files", key: event.input.path, op: "write" };
  }
  if (isToolCallEventType("bash", event)) {
    return { category: "bash", key: event.input.command };
  }
  if (event.toolName === "web_fetch") {
    const input = event.input as { urls?: string[] };
    const url = input.urls?.[0];
    if (!url) return null;
    return { category: "web", key: url };
  }
  return null;
}

export default function (pi: ExtensionAPI) {
  let sessionId: string | null = null;

  pi.on("session_start", async (_event, ctx) => {
    sessionId = getSessionId(ctx.sessionManager);
    cleanup(ctx.cwd);
  });

  pi.registerCommand("permissions", {
    description: "View and manage file, web, and bash permissions",
    handler: async (_args, ctx) => await handlePermissionsCommand(ctx),
  });

  pi.on("tool_call", async (event, ctx) => {
    if (isYolo() || !sessionId) return;

    const check = getPermissionCheck(event);
    if (!check) return;

    const allowed = await resolvePermission(ctx.cwd, sessionId, check);
    if (allowed) return;

    if (!ctx.hasUI) {
      return { block: true, reason: "No UI to prompt for permission" };
    }

    const decision = await showPermissionPrompt(
      ctx,
      event.toolName,
      check.category,
      check.key,
      check.op,
    );

    if (decision.persist) {
      await addRule(
        ctx.cwd,
        decision.persist.scope,
        sessionId,
        check.category,
        decision.persist.key,
        decision.persist.value,
      );
    }

    if (decision.action === "deny") {
      return { block: true, reason: "Permission denied by user" };
    }
  });
}
