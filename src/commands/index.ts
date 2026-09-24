import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { renderSnapshotWidget } from "./render.js";
import { openSubsession } from "../subagent/subsession.js";
import { getPlanCompletions, parseCommandInput, resolvePlan, runPlanLoop } from "./helpers.js";
import { getState } from "../state.js";

const INIT_PROMPT = `Analyze this repository and create or update AGENTS.md in its root. This file gives future coding agents concise, project-specific instructions.

Use only facts verified in repository files. Include build, lint, type-check, and test commands, focused test commands when available, architecture and important directories, coding conventions, and project-specific gotchas. Check existing AGENTS.md and other instruction files such as CLAUDE.md, .cursor/rules, .cursorrules, and .github/copilot-instructions.md. Preserve valid existing guidance and reference related files instead of duplicating them. Do not blindly replace AGENTS.md. Write the file, then briefly report what changed.`;

export default function (pi: ExtensionAPI) {
  let cwd = "";
  let pid = "";

  pi.on("session_start", (_event, ctx) => {
    cwd = ctx.cwd;
    pid = ctx.sessionManager.getSessionId();
  });

  pi.registerCommand("init", {
    description: "Create or update project AGENTS.md instructions",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/init requires interactive UI", "error");
        return;
      }

      const subsession = await openSubsession({
        ctx,
        state: getState(pi),
        label: "subagent",
        agent: "documenter",
        onSnapshot: (snapshot) => renderSnapshotWidget(ctx, "documenter", snapshot),
      });
      try {
        if (subsession.result.status !== "error") {
          await subsession.exec(INIT_PROMPT);
        }

        if (subsession.result.status === "done") {
          ctx.ui.notify("AGENTS.md initialization finished", "info");
          return;
        }
        ctx.ui.notify(subsession.result.output, "error");
      } finally {
        await subsession.dispose();
        ctx.ui.setWidget("documenter", undefined);
      }
    },
  });

  pi.registerCommand("plan", {
    description: `[empty|<plan-id>|<request>] - Resume or start a 'plan' background session. Leave empty to list saved plans`,
    getArgumentCompletions: (prefix) => {
      if (!cwd || !pid) return null;
      return getPlanCompletions(cwd, pid, prefix);
    },
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify(`/plan requires interactive UI`, "error");
        return;
      }

      const parsedInput = parseCommandInput(args);
      const subsession = await resolvePlan(pi, ctx, parsedInput);
      if (!subsession) {
        ctx.ui.setWidget("planner", undefined);
        return;
      }
      if (subsession.result.status === "error") {
        await subsession.dispose();
        ctx.ui.setWidget("planner", undefined);
        ctx.ui.notify(subsession.result.output, "error");
        return;
      }

      await runPlanLoop(pi, ctx, subsession);
    },
  });
}
