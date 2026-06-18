import type { AgentMode } from "../permission/types.js";

export type PlanCommandInput =
  | { kind: "list" }
  | { kind: "resume"; subsessionId: string }
  | { kind: "prompt"; prompt: string };

export type PlanAction =
  | { kind: "forward"; mode: AgentMode }
  | { kind: "revise"; feedback: string };
