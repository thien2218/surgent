import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import readSummarizer from "./truncator/index.js";
import mapper from "./mapper/index.js";

export default function (pi: ExtensionAPI) {
  readSummarizer(pi);
  pi.registerTool(mapper);
}
