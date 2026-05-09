import { WEB_TOOLS_PROVIDERS } from "./settings.js";

export type WebToolsProvider = (typeof WEB_TOOLS_PROVIDERS)[number];
export type WebToolsProviderId = WebToolsProvider["id"];
