import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import readSummarizer from "./truncator/index.js";
import codeMap from "./mapper/index.js";
import inspect from "./inspector/index.js";
import { pruneInspectResults } from "./inspector/helpers.js";

export default function (pi: ExtensionAPI) {
  readSummarizer(pi);

  pi.registerTool(codeMap);
  pi.registerTool(inspect);

  pi.on("context", async (event) => {
    if (!pruneInspectResults(event.messages)) return;
    return { messages: event.messages };
  });
}
