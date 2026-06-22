import type { StoredSubsessions } from "../subsession/types.js";
import { getPiPath, readJson } from "../utils.js";

export interface PlanSessionPreview {
  subsessionId: string;
  title: string;
}

export async function listPlanSessions(cwd: string, pid: string): Promise<PlanSessionPreview[]> {
  const store = await readJson<StoredSubsessions>(getPiPath("subsessions", cwd), {});
  const previews: PlanSessionPreview[] = [];

  for (const [subsessionId, metadata] of Object.entries(store)) {
    if (metadata.label === "plan" && metadata.pid === pid) {
      previews.push({ subsessionId, title: metadata.title });
    }
  }

  return previews;
}
