import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentAllowList, AgentMeta } from "../agent/types.js";

export type SubsessionStatus = "done" | "aborted" | "error";
export type SubsessionLabel = "plan" | "review" | "other";

export interface SubsessionUsage {
  input: number;
  output: number;
  toolCalls: number;
}

export interface SubsessionSnapshot {
  id: string;
  status: "running" | SubsessionStatus;
  toolsUsed: string[];
  usage: SubsessionUsage;
}

export interface SubsessionResult {
  id?: string;
  status: SubsessionStatus;
  output: string;
  usage: SubsessionUsage;
  toolCounts: Record<string, number>;
}

export interface SubsessionMeta {
  label: SubsessionLabel;
  pid: string;
  title: string;
  usage: SubsessionUsage;
}

export interface RuntimeConfig {
  agentMeta: AgentMeta;
  systemPrompt: string;
  tools?: AgentAllowList;
  modelId?: string;
  thinkingLevel?: AgentMeta["thinking_level"];
}

export interface SubsessionRequest {
  context: ExtensionContext;
  pid: string;
  agent: string;
  modelId?: string;
  signal?: AbortSignal;
  id?: string;
  label: SubsessionLabel;
  input: string;
}

export interface StoredSubsessions {
  [id: string]: SubsessionMeta;
}

export interface Subsession {
  pid: string;
  label: SubsessionLabel;
  title: string;
  result: SubsessionResult;
  runtime: RuntimeConfig;
  exec(input: string, signal?: AbortSignal): Promise<void>;
  dispose(): Promise<void>;
}
