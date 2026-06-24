import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { StoredSubsessions } from "../subsession/types.js";
import { getPiPath, readJson } from "../utils.js";

export async function pickSubsessionId(
  ctx: ExtensionContext,
  pid: string,
  label: "plan" | "review",
): Promise<string | null> {
  const store = await readJson<StoredSubsessions>(getPiPath("subsessions", ctx.cwd), {});
  const previews: { subsessionId: string; title: string }[] = [];

  for (const [subsessionId, metadata] of Object.entries(store)) {
    if (metadata.label === label && metadata.pid === pid) {
      previews.push({ subsessionId, title: metadata.title });
    }
  }

  if (previews.length === 0) {
    ctx.ui.notify(`No stored ${label} sessions`, "warning");
    return null;
  }

  const optionMap = new Map<string, string>();
  const options = previews.map((preview) => {
    const optionLabel = `${preview.title} (${preview.subsessionId.slice(0, 8)})`;
    optionMap.set(optionLabel, preview.subsessionId);
    return optionLabel;
  });

  const selectedOption = await ctx.ui.select(`Reopen ${label} session`, options);
  if (!selectedOption) {
    return null;
  }

  return optionMap.get(selectedOption) ?? null;
}
