export * from "./types.js";
export { default as runBackground } from "./background.js";
export { default as runInteractive } from "./interactive.js";
export const IS_SUBSESSION = process.env["SURGENT_SUBSESSION"] === "true";
export const ALLOWED_FILES = process.env["SURGENT_SUBSESSION_FILES"];
