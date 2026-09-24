import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Agent, AgentMode } from "./agent/types.js";
import { writeAgentMode } from "./permission/storage.js";

export const STATE_EVENT = "surgent:state";

export interface AppState {
  dispose(): void;
  getAgent(): Agent;
  getMode(): AgentMode;
  setMode(nextMode: AgentMode): Promise<void>;
}

// One owner per Pi runtime; imports across extensions need not share module memory.
export function createState(
  pi: ExtensionAPI,
  agent: Agent,
  mode: AgentMode,
  onChange: () => void,
): AppState {
  let active = true;
  let pending = Promise.resolve();
  const requireActive = () => {
    if (!active) throw new Error("Session state is unavailable");
  };
  const state = {
    getAgent() {
      requireActive();
      return agent;
    },
    getMode() {
      requireActive();
      return mode;
    },
    setMode(nextMode: AgentMode): Promise<void> {
      if (!["assistant", "yolo", "restricted"].includes(nextMode)) {
        return Promise.reject(new Error("Invalid agent mode"));
      }
      const update = pending.then(async () => {
        requireActive();
        await writeAgentMode(nextMode);
        requireActive();
        mode = nextMode;
        onChange();
      });
      pending = update.catch(() => {});
      return update;
    },
  };
  const unsubscribe = pi.events.on(STATE_EVENT, (reply) => {
    if (typeof reply === "function") reply(state);
  });

  return {
    ...state,
    dispose() {
      active = false;
      unsubscribe();
    },
  };
}

export function getState(pi: ExtensionAPI) {
  let state: AppState | undefined;
  pi.events.emit(STATE_EVENT, (current: NonNullable<typeof state>) => {
    state = current;
  });
  if (!state) throw new Error("Session state is unavailable");
  return state;
}
