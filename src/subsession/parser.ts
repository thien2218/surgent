import type { AssistantMessage, Message, ToolCall } from "@earendil-works/pi-ai";
import type { SubsessionSnapshot } from "./types.js";

interface ParserState {
  messages: Message[];
  toolCounts: Record<string, number>;
  stopReason?: string;
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
  snapshot: SubsessionSnapshot,
  onSnapshot?: (snapshot: SubsessionSnapshot) => void,
) {
  const eventMessage = event["message"];
  if (!eventMessage || typeof eventMessage !== "object") return;

  const message = eventMessage as Message;
  state.messages.push(message);

  if (!isAssistantMessage(message)) {
    snapshot.activity = "thinking";
    onSnapshot?.(snapshot);
    return;
  }

  snapshot.usage.input += message.usage?.input ?? 0;
  snapshot.usage.output += message.usage?.output ?? 0;
  if (message.stopReason) state.stopReason = message.stopReason;

  for (const contentPart of message.content) {
    if (contentPart.type !== "toolCall") continue;
    const toolCall = contentPart as ToolCall;
    const toolName = toolCall.name;

    state.toolCounts[toolName] = (state.toolCounts[toolName] ?? 0) + 1;
    snapshot.usage.toolCalls += 1;
    snapshot.toolsUsed.push(formatToolUse(toolCall));
    onSnapshot?.(snapshot);
  }

  snapshot.activity = "thinking";
  onSnapshot?.(snapshot);
}

function applyEvent(
  event: Record<string, unknown>,
  state: ParserState,
  snapshot: SubsessionSnapshot,
  onSnapshot?: (snapshot: SubsessionSnapshot) => void,
) {
  const eventType = event["type"];

  if (eventType === "session") {
    const sessionId = event["id"];
    if (typeof sessionId === "string") {
      snapshot.id = sessionId;
      onSnapshot?.(snapshot);
    }
    return;
  }

  if (eventType === "tool_execution_start") {
    const toolName = event["toolName"];
    if (typeof toolName === "string") {
      snapshot.activity = toolName;
      onSnapshot?.(snapshot);
    }
    return;
  }

  if (eventType === "message_end") {
    applyMessageEndEvent(event, state, snapshot, onSnapshot);
  }
}

export function createJsonLineParser(
  snapshot: SubsessionSnapshot,
  onSnapshot?: (snapshot: SubsessionSnapshot) => void,
): JsonLineParser {
  let pendingBuffer = "";
  const state: ParserState = { messages: [], toolCounts: {} };

  const processLine = (line: string) => {
    const parsedEvent = parseJsonLine(line);
    if (!parsedEvent) return;
    applyEvent(parsedEvent, state, snapshot, onSnapshot);
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
