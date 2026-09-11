export type LoopAction =
  | { kind: "forward" }
  | { kind: "feedback"; feedback: string }
  | { kind: "open" }
  | { kind: "save" }
  | { kind: "discard" };

export type CommandInput =
  | { kind: "list" }
  | { kind: "resume"; subsessionId: string }
  | { kind: "prompt"; prompt: string };
