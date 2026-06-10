import type { Api, Model } from "@earendil-works/pi-ai";
import type { AgentMeta } from "../agents/types.js";

export interface BackgroundRequest {
  parentId: string;
  agentMeta: AgentMeta;
  task: string;
  files: string[];
  prompt: string;
  tools: string[];
  model?: Model<Api>;
}

export interface BackgroundSnapshot {
  id: string;
  agent: string;
  status: "running" | "done" | "aborted" | "error";
  activity: string;
  toolCounts: Record<string, number>;
}

export interface BackgroundResult {
  status: "done" | "aborted" | "error";
  content: string;
  evidenceRefs: string[];
}

export type OnSnapshotCallback = (snapshot: BackgroundSnapshot) => void;
