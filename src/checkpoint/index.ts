import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { gcCheckpointRepo, openCheckpointRepo } from "./git.js";
import { createSnapshot, retainSnapshot, restoreSnapshot } from "./snapshot.js";
import {
  BASE_CHECKPOINT_KEY,
  readCheckpointStore,
  shouldOfferRestore,
  writeCheckpointStore,
} from "./store.js";

export default function (pi: ExtensionAPI) {
  const checkpoints = new Map<string, string>();
  const pendingCheckpoints = new Map<string, { entryId: string; tree: string }>();
  let checkpointRepo: { projectRoot: string; directory: string } | undefined;

  async function saveCheckpoints(ctx: ExtensionContext) {
    if (!checkpointRepo) return;
    await writeCheckpointStore(
      join(checkpointRepo.directory, "entries.json"),
      ctx.sessionManager.getSessionId(),
      checkpoints,
    );
  }

  async function restoreCheckpoint(
    ctx: ExtensionContext,
    targetEntryId: string,
    currentEntryId: string | null,
  ): Promise<{ cancel: boolean } | void> {
    if (!ctx.hasUI || !checkpointRepo) return;

    const decision = shouldOfferRestore(targetEntryId, currentEntryId, ctx, checkpoints);
    if (!decision.shouldRestore || !decision.tree) return;

    const options = ["Yes, restore code to that point", "No, keep current code"];
    const choice = await ctx.ui.select("Restore code state?", options);
    if (choice !== options[0]) return;

    const restoreResult = await restoreSnapshot(
      pi,
      checkpointRepo.projectRoot,
      checkpointRepo.directory,
      decision.tree,
    );
    if (restoreResult.code !== 0) {
      const reason = restoreResult.stderr.trim() || restoreResult.stdout.trim();
      ctx.ui.notify(
        reason
          ? `Checkpoint restore failed: ${reason}`
          : "Checkpoint restore failed due to git error.",
        "error",
      );
      return { cancel: true };
    }

    ctx.ui.notify("Code restored to checkpoint", "info");
  }

  pi.on("session_start", async (_event, ctx) => {
    checkpoints.clear();
    pendingCheckpoints.clear();
    checkpointRepo = await openCheckpointRepo(pi, ctx.cwd);
    if (!checkpointRepo) return;

    const store = await readCheckpointStore(join(checkpointRepo.directory, "entries.json"));
    const sessionCheckpoints = store[ctx.sessionManager.getSessionId()] ?? {};
    for (const [entryId, tree] of Object.entries(sessionCheckpoints)) {
      checkpoints.set(entryId, tree);
    }

    if (checkpoints.has(BASE_CHECKPOINT_KEY)) return;
    const tree = await createSnapshot(pi, checkpointRepo.projectRoot, checkpointRepo.directory);
    if (tree && (await retainSnapshot(pi, checkpointRepo.projectRoot, checkpointRepo.directory, tree))) {
      checkpoints.set(BASE_CHECKPOINT_KEY, tree);
    }
  });

  pi.on("tool_call", async (event, ctx) => {
    if ((event.toolName !== "write" && event.toolName !== "edit") || !checkpointRepo) return;

    const entryId = ctx.sessionManager.getLeafId();
    if (!entryId) return;

    const tree = await createSnapshot(pi, checkpointRepo.projectRoot, checkpointRepo.directory);
    if (tree) pendingCheckpoints.set(event.toolCallId, { entryId, tree });
  });

  pi.on("tool_result", async (event) => {
    const pendingCheckpoint = pendingCheckpoints.get(event.toolCallId);
    if (!pendingCheckpoint) return;
    pendingCheckpoints.delete(event.toolCallId);
    if (event.isError || !checkpointRepo) return;

    const retained = await retainSnapshot(
      pi,
      checkpointRepo.projectRoot,
      checkpointRepo.directory,
      pendingCheckpoint.tree,
    );
    if (retained) checkpoints.set(pendingCheckpoint.entryId, pendingCheckpoint.tree);
  });

  pi.on("session_before_tree", (event, ctx) => {
    const { targetId, oldLeafId } = event.preparation;
    return restoreCheckpoint(ctx, targetId, oldLeafId);
  });

  pi.on("session_before_fork", (event, ctx) => {
    return restoreCheckpoint(ctx, event.entryId, ctx.sessionManager.getLeafId());
  });

  pi.on("agent_end", async (_event, ctx) => {
    await saveCheckpoints(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    await saveCheckpoints(ctx);
    if (!checkpointRepo) return;
    await gcCheckpointRepo(pi, checkpointRepo.projectRoot, checkpointRepo.directory);
  });
}
