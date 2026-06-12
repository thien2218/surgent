import { SCOPES, PERMISSIVE_TOOLS } from "./constants.js";

type FileOp = "read" | "write";

export type AgentMode = "assistant" | "yolo";
export type PermissiveToolName = keyof typeof PERMISSIVE_TOOLS;
export type Scope = (typeof SCOPES)[number];
export type Category = (typeof PERMISSIVE_TOOLS)[PermissiveToolName]["category"];
export type FileAccess = FileOp | "blocked";

export interface PermissionRule {
  file?: Record<string, FileAccess>;
  web?: Record<string, boolean>;
  bash?: Record<string, boolean>;
}

export interface PermissionCheck {
  toolName: PermissiveToolName;
  category: Category;
  raw: string;
  danger?: string;
  op?: FileOp;
}

export interface PromptDecision {
  allowed: boolean;
  amended?: string;
}

export interface DisplayRule {
  expr: string;
  value: FileAccess | boolean;
  scope: Scope;
}

export type GroupedDisplayRules = {
  file: DisplayRule[];
  web: DisplayRule[];
  bash: DisplayRule[];
};
