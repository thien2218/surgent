import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import pruner from "./pruner/index.js";
import reducer from "./reducer/index.js";
import mapper from "./mapper/index.js";
import inspect from "./inspector/index.js";
import languages from "./languages/index.js";

export default function (pi: ExtensionAPI) {
  reducer(pi);
  languages(pi);
  pruner(pi);
  mapper(pi);
  pi.registerTool(inspect);
}
