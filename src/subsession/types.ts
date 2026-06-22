import type { AgentAllowList } from "../agent/types.js";

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
}

export interface SubsessionResult {
  id?: string;
  status: SubsessionStatus;
  output: string;
  usage?: { input: number; output: number };
  toolCounts: Record<string, number>;
  interaction?: Interaction;
}

export interface SubsessionMeta {
  label: SubsessionLabel;
  agent: string;
  title: string;
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
  [pid: string]: { [id: string]: SubsessionMeta };
}

export interface Subsession {
  pid: string;
  label: SubsessionLabel;
  title: string;
  result: SubsessionResult;
  runtime: RuntimeConfig;
  exec(input: string, signal?: AbortSignal): Promise<void>;
}
