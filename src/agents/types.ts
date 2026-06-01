export interface AgentMeta {
  name: string;
  description: string;
  tools?: string[];
  mcp_servers?: string[];
  subagents?: string[];
  skills?: string[];
  bash?: string[];
  files?: string[];
  model?: string;
}

export interface Agent {
  meta: AgentMeta;
  body: string;
  filePath: string;
}

export interface SessionState {
  yolo: boolean;
  agent: string;
}
