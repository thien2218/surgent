export type AgentMode = "assistant" | "yolo";

export type AgentAllowList = "none" | string[];

export interface AgentMeta {
  description: string;
  tools?: AgentAllowList;
  mcp_servers?: AgentAllowList;
  skills?: AgentAllowList;
  bash?: AgentAllowList;
  files?: AgentAllowList;
  model?: string;
  thinking_level?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
}

export interface Agent {
  name: string;
  meta: AgentMeta;
  body: string;
  filePath: string;
}

export interface SettingsSchema {
  agent?: {
    mode?: AgentMode;
    meta?: Record<string, Partial<AgentMeta>>;
  };
  [key: string]: unknown;
}
