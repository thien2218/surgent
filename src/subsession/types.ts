import type { AgentAllowList } from "../agent/types.js";

export type SubsessionUsage = {
  input: number;
  output: number;
  toolCalls: number;
};

export interface Interaction {
  toolName: string;
  input: Record<string, any>;
}

export type SubsessionStatus = "done" | "aborted" | "error" | "pending";
export type SubsessionLabel = "plan" | "review" | "other";

export interface SubsessionSnapshot {
  id: string;
  status: "running" | SubsessionStatus;
  activity: string;
  toolsUsed: string[];
  usage: SubsessionUsage;
}

export interface SubsessionResult {
  id?: string;
  status: SubsessionStatus;
  output: string;
  usage: SubsessionUsage;
  toolCounts: Record<string, number>;
  interaction?: Interaction;
}

export interface SubsessionMeta {
  label: SubsessionLabel;
  pid: string;
  title: string;
  usage: SubsessionUsage;
}

export interface RuntimeConfig {
  systemPrompt: string;
  tools?: AgentAllowList;
  modelId?: string;
}

export interface SubsessionRequest {
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
}
