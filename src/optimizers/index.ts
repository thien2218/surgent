import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import readSummarizer from "./truncator/index.js";
import codeMap from "./mapper/index.js";
import inspect from "./inspector/index.js";

export default function (pi: ExtensionAPI) {
  readSummarizer(pi);
  pi.registerTool(codeMap);
  pi.registerTool(inspect);
}
