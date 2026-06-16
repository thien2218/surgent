import { safeParseAllowList } from "./herlpers.js";

export { allowListUnion } from "./herlpers.js";
export { default as runBackground } from "./background.js";
export { default as runInteractive } from "./interactive.js";
export const IS_SUBSESSION = process.env["SURGENT_SUBSESSION"] === "true";
export const SUBAGENT = process.env["SURGENT_SUBAGENT"];
export const SUBSESSION_ALLOWED_FILES = safeParseAllowList(process.env["SURGENT_SUBSESSION_FILES"]);
export const SUBSESSION_ALLOWED_BASH = safeParseAllowList(process.env["SURGENT_SUBSESSION_BASH"]);
