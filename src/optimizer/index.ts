import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import context from "./context.js";
import compactor from "./compactor/index.js";
import mapper from "./mapper/index.js";
import inspect from "./inspector/index.js";
import languages from "./languages/index.js";

export default function (pi: ExtensionAPI) {
  compactor(pi);
  languages(pi);
  context(pi);
  mapper(pi);
  pi.registerTool(inspect);
}
