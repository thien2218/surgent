import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import readSummarizer from "./truncator/index.js";

export default function (pi: ExtensionAPI) {
  readSummarizer(pi);
}
