import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import truncator from "./truncator/index.js";
import codeMap from "./mapper/index.js";
import inspect from "./inspector/index.js";
import languages from "./languages/index.js";
// import { pruneContextToolResults } from "./pruner/index.js";

export default function (pi: ExtensionAPI) {
  truncator(pi);
  languages(pi);

  pi.registerTool(codeMap);
  pi.registerTool(inspect);

  // pi.on("context", async (event) => {
  //   if (!pruneContextToolResults(event.messages)) return;
  //   return { messages: event.messages };
  // });
}
