import type { AgentSession, ContextUsage, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentMeta } from "../agent/types.js";
import type { AppState } from "../state.js";

type SubsessionStatus = "done" | "aborted" | "error";

export interface Cost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface SubsessionUsage {
  input: number;
  output: number;
  toolCalls: number;
  cost: Cost;
}

export interface SubsessionSnapshot {
  id: string;
  status: "running" | SubsessionStatus;
  toolsUsed: string[];
  usage: SubsessionUsage;
  contextUsage?: ContextUsage;
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
  state: AppState;
  inMemory?: true;
  agent: string;
  id?: string;
  signal?: AbortSignal;
  onSnapshot: (snapshot: SubsessionSnapshot) => void;
}

export interface StoredSubsessions {
  [id: string]: {
    agent: string;
    inMemory?: true;
    pid: string;
    title: string;
    usage: SubsessionUsage;
  };
}

export interface Subsession {
  pid: string;
  inMemory?: true;
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
  inMemory?: true;
  result: SubsessionResult;
  runtime: RuntimeConfig;
  session?: AgentSession;
  onSnapshot: (snapshot: SubsessionSnapshot) => void;
}
