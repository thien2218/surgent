export * from "./types.js";
export { default as runBackground } from "./background.js";
export const IS_SUBSESSION = process.env["SURGENT_SUBSESSION"] === "true";
