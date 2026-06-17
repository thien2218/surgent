import type { AgentAllowList } from "../agent/types.js";

export type SubsessionResultStatus = "done" | "aborted" | "error";
export type InteractiveLabel = "plan" | "review";

interface SubsessionRequestBase {
  parentId: string;
  agent: string;
  signal?: AbortSignal;
}

export interface SubsessionSnapshot {
  id: string;
  status: "running" | SubsessionResultStatus;
  activity: string;
  toolsUsed: string[];
}

export interface SubsessionResult {
  status: SubsessionResultStatus;
  output: string;
  usage?: { input: number; output: number };
  toolCounts: Record<string, number>;
}

export interface BackgroundRequest extends SubsessionRequestBase {
  task: string;
}

export interface InteractiveMeta {
  label: InteractiveLabel;
  agent: string;
  title: string;
}

export interface InteractiveSubsessions {
  [parentId: string]: {
    [id: string]: InteractiveMeta;
  };
}

export interface RuntimeConfig {
  systemPrompt: string;
  tools?: AgentAllowList;
  modelId?: string;
}

export interface InteractiveRequest extends SubsessionRequestBase {
  id?: string;
  label: InteractiveLabel;
  input: string;
}

export interface InteractiveSubsession {
  id: string;
  parentId: string;
  label: InteractiveLabel;
  title: string;
  result: SubsessionResult;
  runtime: RuntimeConfig;
  exec(input: string, signal?: AbortSignal): Promise<void>;
}
