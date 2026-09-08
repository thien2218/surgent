import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parseCommandInput, resolveSubsession, runSubsessionLoop } from "./helpers.js";

const PROFILES = [
  { name: "plan", agent: "planner", submitText: "Implement this plan" },
  { name: "review", agent: "reviewer", submitText: "Fix issues from review" },
] as const;

export default function (pi: ExtensionAPI) {
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
