import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import deduplicator from "./deduplicator/index.js";
import compactor from "./compactor/index.js";
import codeMap from "./mapper/index.js";
import inspect from "./inspector/index.js";
import languages from "./languages/index.js";
import pruner from "./pruner/index.js";

const optimizerKey = Symbol.for("@surgent/optimizers");

export default function (pi: ExtensionAPI) {
  if (Reflect.get(globalThis, optimizerKey)) return;
  Reflect.set(globalThis, optimizerKey, true);

  try {
    compactor(pi);
    languages(pi);
    deduplicator(pi);
    pruner(pi);

    pi.registerTool(codeMap);
    pi.registerTool(inspect);
  } catch (error) {
    Reflect.deleteProperty(globalThis, optimizerKey);
    throw error;
  }
}
