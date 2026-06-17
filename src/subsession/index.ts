export { default as runBackground } from "./background.js";
export { default as runInteractive } from "./interactive.js";
export const IS_SUBSESSION = process.env["SURGENT_SUBSESSION"] === "true";
export const SUBAGENT = process.env["SURGENT_SUBAGENT"];
