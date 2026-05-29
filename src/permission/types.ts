import { SCOPES, PERMISSIVE_TOOLS } from "./constants.js";

type FileOp = "read" | "write";

export type PermissiveToolName = keyof typeof PERMISSIVE_TOOLS;
export type Scope = (typeof SCOPES)[number];
export type Category = (typeof PERMISSIVE_TOOLS)[PermissiveToolName]["category"];
export type FileAccess = FileOp | "blocked";

export interface PermSchema {
  file?: Record<string, FileAccess>;
  web?: Record<string, boolean>;
  bash?: Record<string, boolean>;
}

export interface LocalSchema {
  project?: PermSchema;
  [sessionId: string]: PermSchema | undefined;
}

export interface PermCheck {
  toolName: PermissiveToolName;
  category: Category;
  expr: string;
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
  category: Category;
}
