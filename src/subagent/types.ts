import type { AgentSession, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentMeta } from "../agent/types.js";

export type SubsessionStatus = "done" | "aborted" | "error";
export type SubsessionLabel = "plan" | "review" | "subagent";

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

export interface RuntimeConfig {
  agent: string;
  builtIn: boolean;
  meta: AgentMeta;
  systemPrompt: string;
}

export interface SubsessionRequest {
  ctx: ExtensionContext;
  label: SubsessionLabel;
  agent: string;
  id?: string;
  signal?: AbortSignal;
  onSnapshot: (snapshot: SubsessionSnapshot) => void;
}

export interface StoredSubsessions {
  [id: string]: {
    agent: string;
    label: SubsessionLabel;
    pid: string;
    title: string;
    usage: SubsessionUsage;
  };
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

export interface ExecuteTurnRequest {
  input: string;
  session: AgentSession;
  usage: SubsessionUsage;
  signal?: AbortSignal;
  onSnapshot: (snapshot: SubsessionSnapshot) => void;
}

export interface CreateSubsessionParams {
  pid: string;
  cwd: string;
  title: string;
  label: SubsessionLabel;
  result: SubsessionResult;
  runtime: RuntimeConfig;
  session?: AgentSession;
  onSnapshot: (snapshot: SubsessionSnapshot) => void;
}
