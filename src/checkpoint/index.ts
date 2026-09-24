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

export interface Repo {
  projectRoot: string;
  directory: string;
}

export default function (pi: ExtensionAPI) {
  const checkpoints = new Map<string, string>();
  let turnChanged = false;
  let repo: Repo | undefined;

  async function saveCheckpoints(ctx: ExtensionContext) {
    if (!repo) return;
    await writeCheckpointStore(
      join(repo.directory, "entries.json"),
      ctx.sessionManager.getSessionId(),
      checkpoints,
    );
  }

  async function restoreCheckpoint(
    ctx: ExtensionContext,
    targetEntryId: string,
    currentEntryId: string | null,
  ): Promise<{ cancel: boolean } | void> {
    if (!ctx.hasUI || !repo) return;

    const decision = shouldOfferRestore(targetEntryId, currentEntryId, ctx, checkpoints);
    if (!decision.shouldRestore || !decision.tree) return;

    const options = ["Yes, restore code to that point", "No, keep current code"];
    const choice = await ctx.ui.select("Restore code state?", options);
    if (choice !== options[0]) return;

    const restoreResult = await restoreSnapshot(pi, repo, decision.tree);
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
    turnChanged = false;
    repo = await openCheckpointRepo(pi, ctx.cwd);
    if (!repo) return;

    const store = await readCheckpointStore(join(repo.directory, "entries.json"));
    const sessionCheckpoints = store[ctx.sessionManager.getSessionId()] ?? {};
    for (const [entryId, tree] of Object.entries(sessionCheckpoints)) {
      checkpoints.set(entryId, tree);
    }

    if (checkpoints.has(BASE_CHECKPOINT_KEY)) return;
    const tree = await createSnapshot(pi, repo);
    if (tree && (await retainSnapshot(pi, repo, tree))) {
      checkpoints.set(BASE_CHECKPOINT_KEY, tree);
    }
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    if (!repo) return;

    const tree = await createSnapshot(pi, repo);
    if (tree && (await retainSnapshot(pi, repo, tree))) {
      checkpoints.set(ctx.sessionManager.getLeafId() ?? BASE_CHECKPOINT_KEY, tree);
    }
  });

  pi.on("turn_start", () => {
    turnChanged = false;
  });

  pi.on("tool_result", (event) => {
    if (
      (event.toolName === "write" || event.toolName === "edit" || event.toolName === "subagent") &&
      !event.isError
    ) {
      turnChanged = true;
    }
  });

  pi.on("turn_end", async (_event, ctx) => {
    if (!turnChanged || !repo) return;
    turnChanged = false;

    const entryId = ctx.sessionManager.getLeafId();
    if (!entryId) return;

    const tree = await createSnapshot(pi, repo);
    if (tree && (await retainSnapshot(pi, repo, tree))) {
      checkpoints.set(entryId, tree);
    }
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
    if (!repo) return;
    await gcCheckpointRepo(pi, repo);
  });
}
