import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import bash from "./bash.js";
import grep from "./grep.js";
import read from "./read.js";

export default function (pi: ExtensionAPI) {
  read(pi);
  grep(pi);
  bash(pi);
}
