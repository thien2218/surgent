import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import deduplicator from "./deduplicator/index.js";
import summarizer from "./summarizer/index.js";
import codeMap from "./mapper/index.js";
import inspect from "./inspector/index.js";
import languages from "./languages/index.js";
import pruner from "./pruner/index.js";

export default function (pi: ExtensionAPI) {
  summarizer(pi);
  languages(pi);
  deduplicator(pi);
  pruner(pi);

  pi.registerTool(codeMap);
  pi.registerTool(inspect);
}
