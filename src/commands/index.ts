import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { renderSnapshotWidget } from "../subagent/helpers.js";
import { openSubsession } from "../subagent/subsession.js";
import { parseCommandInput, resolveSubsession, runSubsessionLoop } from "./helpers.js";

const PROFILES = [
  { name: "plan", agent: "planner", submitText: "Implement this plan" },
  { name: "review", agent: "reviewer", submitText: "Fix issues from review" },
] as const;

const INIT_PROMPT = `Analyze this repository and create or update AGENTS.md in its root. This file gives future coding agents concise, project-specific instructions.

Use only facts verified in repository files. Include build, lint, type-check, and test commands, focused test commands when available, architecture and important directories, coding conventions, and project-specific gotchas. Check existing AGENTS.md and other instruction files such as CLAUDE.md, .cursor/rules, .cursorrules, and .github/copilot-instructions.md. Preserve valid existing guidance and reference related files instead of duplicating them. Do not blindly replace AGENTS.md. Write the file, then briefly report what changed.`;

export default function (pi: ExtensionAPI) {
  pi.registerCommand("init", {
    description: "Create or update project AGENTS.md instructions",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/init requires interactive UI", "error");
        return;
      }

      const subsession = await openSubsession({
        ctx,
        label: "subagent",
        agent: "documenter",
        onSnapshot: (snapshot) =>
          renderSnapshotWidget(ctx, "documenter", snapshot, ctx.model?.contextWindow),
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

  PROFILES.forEach(({ name, agent, submitText }) => {
    pi.registerCommand(name, {
      description: `Run ${agent} agent in a dedicated subsession`,
      handler: async (args, ctx) => {
        if (!ctx.hasUI) {
          ctx.ui.notify(`/${name} requires interactive UI`, "error");
          return;
        }

        const parsedInput = parseCommandInput(args);
        const subsession = await resolveSubsession(ctx, parsedInput, { label: name, agent });

        if (!subsession) {
          ctx.ui.setWidget(agent, undefined);
          return;
        }
        if (subsession.result.status === "error") {
          await subsession.dispose();
          ctx.ui.setWidget(agent, undefined);
          ctx.ui.notify(subsession.result.output, "error");
          return;
        }

        await runSubsessionLoop(pi, ctx, subsession, { agent, submitText });
      },
    });
  });
}
