import {
  appendFileSync,
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
export function rewriteTailWithSummaries(
  sessionFile: string,
  runStartOffset: number,
  completedRunSummaries: Map<string, string>,
) {
  if (completedRunSummaries.size === 0) return;

  const sessionBuffer = readFileSync(sessionFile);
  if (runStartOffset > sessionBuffer.length) return;

  const prefixBuffer = sessionBuffer.subarray(0, runStartOffset);
  const tailText = sessionBuffer.subarray(runStartOffset).toString("utf-8");
  if (tailText.length === 0) return;

  let changed = false;
  const rewrittenTail = tailText
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const entry = JSON.parse(line) as Record<string, unknown>;
      const message = entry.message as Record<string, unknown> | undefined;
      if (
        entry.type === "message" &&
        message?.role === "toolResult" &&
        typeof message.toolCallId === "string" &&
        completedRunSummaries.has(message.toolCallId)
      ) {
        changed = true;
        return JSON.stringify({
          ...entry,
          message: {
            ...message,
            content: [{ type: "text", text: completedRunSummaries.get(message.toolCallId)! }],
          },
        });
      }
      return line;
    })
    .join("\n");

  if (!changed) return;
  const tempFile = `${sessionFile}.${process.pid}.${Date.now()}.tmp`;

  try {
    writeFileSync(tempFile, prefixBuffer);
    appendFileSync(tempFile, `${rewrittenTail}\n`, "utf8");
    renameSync(tempFile, sessionFile);
  } finally {
    if (existsSync(tempFile)) {
      unlinkSync(tempFile);
    }
  }
}
