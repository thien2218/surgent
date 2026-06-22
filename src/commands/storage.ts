import type { StoredSubsessions } from "../subsession/types.js";
import { getPiPath, readJson } from "../utils.js";

export interface PlanSessionPreview {
  subsessionId: string;
  title: string;
}

export async function listPlanSessions(
  cwd: string,
  parentSessionId: string,
): Promise<PlanSessionPreview[]> {
  const store = await readJson<StoredSubsessions>(getPiPath("subsessions", cwd), {});
  const currentSessionSubsessions = store[parentSessionId] ?? {};

  const previews: PlanSessionPreview[] = [];
  for (const [subsessionId, metadata] of Object.entries(currentSessionSubsessions)) {
    if (metadata.label !== "plan") {
      continue;
    }

    previews.push({ subsessionId, title: metadata.title });
  }

  return previews;
}
