import type { AssistantMessage, Message, ToolCall } from "@earendil-works/pi-ai";

interface ParserState {
  sessionId: string;
  messages: Message[];
  toolCounts: Record<string, number>;
  tokenInput: number;
  tokenOutput: number;
  stopReason?: string;
  activity: string;
}

interface ParserHooks {
  onActivity?: (activity: string) => void;
  onToolUse?: (toolUse: string) => void;
  onSessionId?: (id: string) => void;
}

interface JsonLineParser {
  readonly state: ParserState;
  push(chunk: string): void;
  flush(): void;
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  if (!line.trim()) return null;

  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isAssistantMessage(message: Message): message is AssistantMessage {
  return message.role === "assistant";
}

export function getFinalOutput(messages: Message[]): string {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (!message || message.role !== "assistant") continue;

    for (const contentPart of message.content) {
      if (contentPart.type === "text") return contentPart.text;
    }
  }

  return "";
}

function formatToolUse(toolCall: ToolCall): string {
  const args = toolCall.arguments;
  if (!args || typeof args !== "object" || Object.keys(args).length === 0) {
    return `${toolCall.name}()`;
  }

  try {
    return `${toolCall.name}(${JSON.stringify(args)})`;
  } catch {
    return `${toolCall.name}(<args>)`;
  }
}

function applyMessageEndEvent(
  event: Record<string, unknown>,
  state: ParserState,
  hooks: ParserHooks,
): void {
  const eventMessage = event["message"];
  if (!eventMessage || typeof eventMessage !== "object") return;

  const message = eventMessage as Message;
  state.messages.push(message);

  if (!isAssistantMessage(message)) {
    state.activity = "thinking";
    hooks.onActivity?.(state.activity);
    return;
  }

  state.tokenInput += message.usage?.input ?? 0;
  state.tokenOutput += message.usage?.output ?? 0;
  if (message.stopReason) state.stopReason = message.stopReason;

  for (const contentPart of message.content) {
    if (contentPart.type !== "toolCall") continue;

    const toolCall = contentPart as ToolCall;
    const toolName = toolCall.name;
    state.toolCounts[toolName] = (state.toolCounts[toolName] ?? 0) + 1;
    hooks.onToolUse?.(formatToolUse(toolCall));
  }

  state.activity = "thinking";
  hooks.onActivity?.(state.activity);
}

function applyEvent(event: Record<string, unknown>, state: ParserState, hooks: ParserHooks): void {
  const eventType = event["type"];

  if (eventType === "session") {
    const sessionId = event["id"];
    if (typeof sessionId === "string") {
      state.sessionId = sessionId;
      hooks.onSessionId?.(sessionId);
    }
    return;
  }

  if (eventType === "tool_execution_start") {
    const toolName = event["toolName"];
    if (typeof toolName === "string") {
      state.activity = toolName;
      hooks.onActivity?.(state.activity);
    }
    return;
  }

  if (eventType === "message_end") {
    applyMessageEndEvent(event, state, hooks);
  }
}

export function createJsonLineParser(hooks: ParserHooks = {}): JsonLineParser {
  const state: ParserState = {
    sessionId: "",
    messages: [],
    toolCounts: {},
    tokenInput: 0,
    tokenOutput: 0,
    activity: "thinking",
  };

  let pendingBuffer = "";

  const processLine = (line: string) => {
    const parsedEvent = parseJsonLine(line);
    if (!parsedEvent) return;
    applyEvent(parsedEvent, state, hooks);
  };

  return {
    state,
    push(chunk: string) {
      pendingBuffer += chunk;
      const lines = pendingBuffer.split("\n");
      pendingBuffer = lines.pop() ?? "";
      for (const line of lines) processLine(line);
    },
    flush() {
      if (!pendingBuffer.trim()) return;
      processLine(pendingBuffer);
      pendingBuffer = "";
    },
  };
}
