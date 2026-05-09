import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import webLoginCommand from "./web-login.js";

export default async function webAuthExtension(pi: ExtensionAPI) {
  await webLoginCommand(pi);
}
