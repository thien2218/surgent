import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import deduplicator from "./deduplicator/index.js";
import compactor from "./compactor/index.js";
import mapper from "./mapper/index.js";
import inspect from "./inspector/index.js";
import languages from "./languages/index.js";
import pruner from "./pruner/index.js";

export default function (pi: ExtensionAPI) {
  compactor(pi);
  languages(pi);
  deduplicator(pi);
  pruner(pi);
  mapper(pi);
  pi.registerTool(inspect);
}
