import type { AgentMode } from "../agent/types.js";

export type LoopAction =
  | { kind: "forward"; mode: AgentMode }
  | { kind: "feedback"; feedback: string }
  | { kind: "exit" }
  | { kind: "discard" };

export type CommandInput =
  | { kind: "list" }
  | { kind: "resume"; subsessionId: string }
  | { kind: "prompt"; prompt: string };

export interface LoopConfig {
  agent: string;
  title: string;
  prefix: string;
  placeholder: string;
}
