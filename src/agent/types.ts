export type AgentAllowList = "all" | string[];

export interface AgentMeta {
  name: string;
  description: string;
  tools?: AgentAllowList;
  mcp_servers?: AgentAllowList;
  skills?: AgentAllowList;
  bash?: AgentAllowList;
  files?: AgentAllowList;
  model?: string;
}

export interface Agent {
  meta: AgentMeta;
  body: string;
  filePath: string;
}
