export type AgentAllowList = "none" | string[];

export interface AgentMeta {
  description: string;
  tools?: AgentAllowList;
  mcp_servers?: AgentAllowList;
  skills?: AgentAllowList;
  bash?: AgentAllowList;
  files?: AgentAllowList;
  model?: string;
}

export interface Agent {
  name: string;
  meta: AgentMeta;
  body: string;
  filePath: string;
}
