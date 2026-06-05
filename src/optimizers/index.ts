import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import readSummarizer from "./read-summarizer/index.js";

export default function (pi: ExtensionAPI) {
  readSummarizer(pi);
}
