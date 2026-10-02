export type AgentMode = "assistant" | "yolo" | "restricted";

export interface AgentMeta {
  description: string;
  tools?: string[];
  mcp_tools?: string[];
  skills?: string[];
  bash?: string[];
  "files.read"?: string[];
  "files.write"?: string[];
  model?: string;
  thinking_level?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
}

export interface Agent {
  name: string;
  meta: AgentMeta;
  body: string;
  filePath: string;
}

export type AgentProfile = {
  name: string;
  filePath: string;
  scope: "local" | "global" | "built-in";
} & ({ agent: Agent; error?: never } | { agent?: never; error: string });

export interface SettingsSchema {
  agent?: {
    mode?: AgentMode;
    meta?: Record<string, Partial<AgentMeta>>;
  };
  [key: string]: unknown;
}
