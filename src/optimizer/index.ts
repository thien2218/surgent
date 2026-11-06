import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import pruner from "./pruner/index.js";
import deduplicator from "./deduplicator/index.js";
import reducer from "./reducer/index.js";
import mapper from "./mapper/index.js";
import inspect from "./inspector/index.js";
import grammar from "./grammar/index.js";
import { applyPatch } from "./patcher/index.js";

export default function (pi: ExtensionAPI) {
  reducer(pi);
  grammar(pi);
  pruner(pi);
  deduplicator(pi);
  mapper(pi);

  pi.registerTool(inspect);
  pi.registerTool(applyPatch); // reduce reasoning tokens per edit for GPT models
}
