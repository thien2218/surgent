export const SUBSESSION_DIR_NAME = "subsessions";
export { default as runSubsession } from "./execute.js";
export {
  createResumeInput,
  emitInteractionHandoff,
  resolveInteractionHandoff,
  renderSnapshotWidget,
} from "./helpers.js";
export const IS_SUBSESSION = process.env["SURGENT_SUBSESSION"] === "true";
export const SUBAGENT = process.env["SURGENT_SUBAGENT"];
