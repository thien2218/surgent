import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import bash from "./bash.js";
import grep from "./grep.js";

export default function (pi: ExtensionAPI) {
  grep(pi);
  bash(pi);
}
