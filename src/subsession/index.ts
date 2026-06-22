export const SUBSESSION_DIR_NAME = "subsessions";
export { default as runInteractive } from "./execute.js";
export { createResumeInput, emitInteractionHandoff } from "./helpers.js";
export const IS_SUBSESSION = process.env["SURGENT_SUBSESSION"] === "true";
export const SUBAGENT = process.env["SURGENT_SUBAGENT"];
