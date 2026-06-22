export const SUBSESSION_DIR_NAME = "subsessions";
export const HANDOFF_PREFIX = "subsession_handoff:";
export { default as runInteractive } from "./execute.js";
export { createResumeInput } from "./helpers.js";
export const IS_SUBSESSION = process.env["SURGENT_SUBSESSION"] === "true";
export const SUBAGENT = process.env["SURGENT_SUBAGENT"];
