export type LoopAction =
  | { kind: "forward" }
  | { kind: "feedback"; feedback: string }
  | { kind: "exit" }
  | { kind: "discard" };

export type CommandInput =
  | { kind: "list" }
  | { kind: "resume"; subsessionId: string }
  | { kind: "prompt"; prompt: string };

export interface LoopConfig {
  agent: string;
  submitText: string;
}
