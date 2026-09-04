import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parseCommandInput, resolveSubsession, runSubsessionLoop } from "./helpers.js";

export const MODE_ENTRY = "commands/mode";

const PROFILES = [
  {
    name: "plan",
    agent: "planner",
    title: "Forward this plan to main agent?",
    prefix: "Yes, proceed",
    placeholder: "Tell planner what to revise...",
  },
  {
    name: "review",
    agent: "reviewer",
    title: "Next step?",
    prefix: "Fix issues",
    placeholder: "Tell reviewer what to check again...",
  },
] as const;

export default function (pi: ExtensionAPI) {
  PROFILES.forEach(({ name, agent, ...rest }) => {
    pi.registerCommand(name, {
      description: `Run ${agent} agent in a dedicated subsession`,
      handler: async (args, ctx) => {
        if (!ctx.hasUI) {
          ctx.ui.notify("/plan requires interactive UI", "error");
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

        await runSubsessionLoop(pi, ctx, subsession, { agent, ...rest });
      },
    });
  });
}
