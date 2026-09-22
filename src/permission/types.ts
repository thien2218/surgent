import type { FormField } from "../ui/components/form-field.js";
import { SCOPES, PERMISSIVE_TOOLS } from "./constants.js";

export type FileOp = "read" | "write";
export type PermissiveToolName = keyof typeof PERMISSIVE_TOOLS;
export type Scope = (typeof SCOPES)[number];
export type Category = (typeof PERMISSIVE_TOOLS)[PermissiveToolName];
export type FileAccess = FileOp | "deny";

export interface PermissionRule {
  file?: Record<string, FileAccess>;
  web?: Record<string, boolean>;
  bash?: Record<string, boolean>;
  mcp?: Record<string, boolean>;
}

export interface PermissionCheck {
  sessionId: string;
  toolName: PermissiveToolName;
  category: Category;
  raw: string;
  unresolved: string[];
  purpose: string;
  uncertainty?: string;
}

export interface PromptDecision {
  allowed: boolean;
  error?: true;
  amended?: string;
}

export interface DisplayRule {
  category: Category;
  pattern: string;
  value: FileAccess | boolean;
  scope: Scope;
}

export type GroupedDisplayRules = {
  file: DisplayRule[];
  web: DisplayRule[];
  bash: DisplayRule[];
  mcp: DisplayRule[];
};

export type PromptOptions = {
  label: string;
  value: PromptDecision;
  persists: boolean;
  separator: string;
  defaultText?: string;
};

export interface BashCommand {
  text: string;
  unresolved: boolean;
}

export interface RuleOptionEntry {
  rule: DisplayRule;
  option: FormField;
  deleted: boolean;
}
