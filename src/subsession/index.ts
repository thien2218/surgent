export * from "./types.js";
export { default as runBackground } from "./background.js";
export { startInteractive } from "./interactive.js";
export const IS_SUBSESSION = process.env["SURGENT_SUBSESSION"] === "true";
