import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import deduplicator from "./deduplicator/index.js";
import truncator from "./truncator/index.js";
import codeMap from "./mapper/index.js";
import inspect from "./inspector/index.js";
import languages from "./languages/index.js";

export default function (pi: ExtensionAPI) {
  truncator(pi);
  languages(pi);
  deduplicator(pi);

  pi.registerTool(codeMap);
  pi.registerTool(inspect);
}
