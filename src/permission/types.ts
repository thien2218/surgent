export type Scope = "session" | "project" | "always";
export type Category = "files" | "web" | "bash";
export type FileAccess = "full" | "readonly" | "blocked";

export interface PermSchema {
  files?: Record<string, FileAccess>;
  web?: Record<string, boolean>;
  bash?: Record<string, boolean>;
}

export interface LocalSchema {
  project?: PermSchema;
  [sessionId: string]: PermSchema | undefined;
}

export interface PromptDecision {
  action: "allow" | "deny";
  persist?: { scope: Scope; key: string; value: boolean | FileAccess };
}

export interface DisplayRule {
  key: string;
  value: FileAccess | boolean;
  scope: Scope;
  category: Category;
}
