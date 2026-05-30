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

export interface ParsedAgent {
  meta: AgentMeta;
  body: string;
  filePath: string;
}
