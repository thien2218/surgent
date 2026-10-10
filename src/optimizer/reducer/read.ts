import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import {
  createReadToolDefinition,
  detectSupportedImageMimeTypeFromFile,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    ...createReadToolDefinition(process.cwd()),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      let fullText: string | undefined;
      let textFile = false;
      const trackedRead = createReadToolDefinition(ctx.cwd, {
        autoResizeImages: pi.getSettings().images?.autoResize ?? true,
        operations: {
          access: (path) => access(path, constants.R_OK),
          async detectImageMimeType(path) {
            const mimeType = await detectSupportedImageMimeTypeFromFile(path);
            textFile = !mimeType;
            return mimeType;
          },
          async readFile(path) {
            const buffer = await readFile(path);
            // Capture this read's text, not a later filesystem snapshot.
            if (textFile) fullText = buffer.toString("utf-8");
            return buffer;
          },
        },
      });

      const result = await trackedRead.execute(toolCallId, params, signal, onUpdate, ctx);
      const first = result.content[0];
      return {
        ...result,
        details: {
          ...result.details,
          fullFile:
            fullText !== undefined &&
            !result.details?.truncation?.truncated &&
            result.content.length === 1 &&
            first?.type === "text" &&
            first.text === fullText,
        },
      };
    },
  });
}
