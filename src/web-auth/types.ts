import { WEB_TOOLS_PROVIDERS } from "../settings.js";

export type WebAuthProvider = (typeof WEB_TOOLS_PROVIDERS)[number];
export type WebAuthProviderId = WebAuthProvider["id"];
