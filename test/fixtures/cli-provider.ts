import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createAssistantMessageEventStream,
  getCurrentTools,
  type AssistantMessage,
  type ToolCall,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type ScriptStep = {
  expect?: {
    prompt?: string;
    result?: {
      toolCallId: string;
      toolName: string;
      isError: boolean;
      includes?: string;
      excludes?: string;
    };
  };
} & (
  | { type: "text"; text: string }
  | { type: "tool"; call: ToolCall }
  | { type: "hold"; text: string }
);

// Loaded explicitly by CLI tests only. No sockets, credentials, or fallback provider.
export default async function (pi: ExtensionAPI) {
  const script: ScriptStep[] = JSON.parse(await readFile(join(process.cwd(), "e2e-script.json"), "utf8"));
  assert.ok(Array.isArray(script), "Expected an array of scripted responses");
  let cursor = 0;
  pi.registerProvider("surgent-e2e", {
    api: "surgent-e2e-scripted",
    baseUrl: "https://surgent-e2e.invalid",
    apiKey: "fake-e2e-key",
    models: [{
      id: "scripted",
      name: "Offline scripted model",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200_000,
      maxTokens: 4096,
    }],
    streamSimple(model, context, options) {
      const stream = createAssistantMessageEventStream();
      const message: AssistantMessage = {
        role: "assistant",
        api: model.api,
        provider: model.provider,
        model: model.id,
        timestamp: Date.now(),
        content: [],
        stopReason: "pending",
        usage: {
          input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      };
      void (async () => {
        let removeAbort = () => {};
        try {
          const payload = await options?.onPayload?.(context, model) ?? context;
          assert.ok(payload && typeof payload === "object" && "messages" in payload && Array.isArray(payload.messages),
            "Expected transcript messages in provider payload");
          const messages = (payload as TranscriptContext).messages;
          options?.signal?.throwIfAborted();
          const step = script[cursor++];
          assert.ok(step, "Script exhausted: unexpected model request");
          if (step.expect?.prompt !== undefined) {
            const user = messages.findLast((entry) => entry.role === "user");
            const text = typeof user?.content === "string" ? user.content
              : user?.content.filter((part) => part.type === "text").map((part) => part.text).join("");
            assert.equal(text, step.expect.prompt, "Unexpected user prompt");
          }
          if (step.expect?.result) {
            const expected = step.expect.result;
            const result = messages.findLast((entry) => entry.role === "toolResult" && entry.toolCallId === expected.toolCallId);
            assert.ok(result?.role === "toolResult", `Missing tool result: ${expected.toolCallId}`);
            assert.equal(result.toolName, expected.toolName, "Unexpected tool result name");
            assert.equal(result.isError, expected.isError, "Unexpected tool result status");
            const text = result.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
            if (expected.includes !== undefined) assert.ok(text.includes(expected.includes), "Expected text missing from tool result");
            if (expected.excludes !== undefined) assert.ok(!text.includes(expected.excludes), "Forbidden text reached model");
          }
          await options?.onResponse?.({ status: 200, headers: {} }, model);
          options?.signal?.throwIfAborted();
          stream.push({ type: "start", partial: message });
          if (step.type === "tool") {
            assert.ok(getCurrentTools(messages).some((tool) => tool.name === step.call.name), `Tool unavailable: ${step.call.name}`);
            assert.ok(step.call.id && step.call.type === "toolCall", "Invalid scripted tool call");
            const call: ToolCall = { ...step.call, arguments: {} };
            message.content.push(call);
            stream.push({ type: "toolcall_start", contentIndex: 0, partial: message });
            call.arguments = step.call.arguments;
            stream.push({ type: "toolcall_delta", contentIndex: 0, delta: JSON.stringify(call.arguments), partial: message });
            stream.push({ type: "toolcall_end", contentIndex: 0, toolCall: call, partial: message });
            message.stopReason = "toolUse";
          } else {
            assert.ok(step.type === "text" || step.type === "hold", "Unknown scripted response type");
            assert.equal(typeof step.text, "string", "Expected scripted text");
            const content = { type: "text" as const, text: "" };
            message.content.push(content);
            stream.push({ type: "text_start", contentIndex: 0, partial: message });
            const emitText = () => {
              content.text = step.text;
              stream.push({ type: "text_delta", contentIndex: 0, delta: step.text, partial: message });
            };
            if (step.type === "hold") {
              assert.ok(options?.signal, "Held response needs an abort signal");
              await new Promise<never>((_resolve, reject) => {
                const abort = () => reject(new Error("Scripted response aborted"));
                options.signal!.addEventListener("abort", abort, { once: true });
                removeAbort = () => options.signal!.removeEventListener("abort", abort);
                if (options.signal!.aborted) abort();
                else emitText(); // Readiness emitted only after abort listener is installed.
              });
            }
            emitText();
            stream.push({ type: "text_end", contentIndex: 0, content: step.text, partial: message });
            message.stopReason = "stop";
          }
          stream.push({ type: "done", reason: message.stopReason, message });
        } catch (error) {
          message.stopReason = options?.signal?.aborted ? "aborted" : "error";
          message.errorMessage = `Scripted provider: ${error instanceof Error ? error.message : String(error)}`;
          stream.push({ type: "error", reason: message.stopReason, error: message });
        } finally {
          removeAbort();
          stream.end();
        }
      })();
      return stream;
    },
  });
}
