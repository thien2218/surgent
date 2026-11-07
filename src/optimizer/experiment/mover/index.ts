import { isUtf8 } from "node:buffer";
import { readFile, stat, writeFile } from "node:fs/promises";
import { defineTool, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { findAnchor, findRange } from "./match.js";
import { normalizeToolPath } from "../../../utils.js";

function withLocks<Result>(paths: string[], work: () => Promise<Result>): Promise<Result> {
  const [head, ...tail] = paths;
  return head ? withFileMutationQueue(head, () => withLocks(tail, work)) : work();
}

const moveSchema = Type.Object({
  source: Type.Object({
    file: Type.String({ description: "Existing source file, relative to cwd or absolute" }),
    start: Type.String({
      description: "Literal beginning of block (included); start or end must be unique",
      minLength: 1,
    }),
    end: Type.String({
      description: "Literal end of block (included). Unique start selects first end after it; otherwise unique end selects nearest start before it",
      minLength: 1,
    }),
  }),
  dest: Type.Object({
    file: Type.String({ description: "Existing destination file, possibly source file" }),
    after: Type.String({
      description: "Unique literal anchor; insert immediately after it, with no added formatting",
      minLength: 1,
    }),
  }),
  duplicate: Type.Optional(
    Type.Boolean({ description: "Copy the block instead of moving it; defaults to false" }),
  ),
});

export type MoveInput = Static<typeof moveSchema>;

const move = defineTool({
  name: "move",
  label: "move",
  description:
    "Move existing text without reproducing it. Supports same-file and cross-file operations. Resolves all anchors before writing; rolls back writes on failure.",
  parameters: moveSchema,
  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    signal?.throwIfAborted();
    const source = normalizeToolPath(params.source.file, ctx.cwd, "edit");
    const dest = normalizeToolPath(params.dest.file, ctx.cwd, "edit");

    return withLocks([...new Set([source, dest])].sort(), async () => {
      signal?.throwIfAborted();
      if (source !== dest) {
        const [sourceStat, destStat] = await Promise.all([stat(source), stat(dest)]);
        if (sourceStat.dev === destStat.dev && sourceStat.ino === destStat.ino) {
          throw new Error(
            "Source and destination are hard links to the same file; use one path for both",
          );
        }
      }

      const sourceBytes = await readFile(source);
      const destBytes = source === dest ? sourceBytes : await readFile(dest);
      if (!isUtf8(sourceBytes) || !isUtf8(destBytes)) {
        throw new Error("move requires UTF-8 text files");
      }

      const original = sourceBytes.toString("utf8");
      const destination = destBytes.toString("utf8");
      const range = findRange(original, params.source.start, params.source.end, "source");
      const insertion = findAnchor(destination, params.dest.after, "dest.after").end;
      const block = original.slice(range.start, range.end);
      const changes = new Map<string, { before: string; after: string }>();

      if (source === dest) {
        let content = original;
        let position = insertion;
        if (!params.duplicate) {
          if (insertion > range.start && insertion < range.end) {
            throw new Error("Cannot cut a block into itself");
          }
          content = original.slice(0, range.start) + original.slice(range.end);
          if (insertion >= range.end) position -= range.end - range.start;
        }
        changes.set(source, {
          before: original,
          after: content.slice(0, position) + block + content.slice(position),
        });
      } else {
        changes.set(dest, {
          before: destination,
          after: destination.slice(0, insertion) + block + destination.slice(insertion),
        });
        if (!params.duplicate) {
          changes.set(source, {
            before: original,
            after: original.slice(0, range.start) + original.slice(range.end),
          });
        }
      }

      signal?.throwIfAborted();
      const attempted: string[] = [];
      try {
        // Finish the write window even if cancelled, so rollback cannot race writes.
        for (const [file, change] of changes) {
          attempted.push(file);
          await writeFile(file, change.after, "utf8");
        }
      } catch (error) {
        const failed: string[] = [];
        for (const file of attempted.reverse()) {
          try {
            await writeFile(file, changes.get(file)!.before, "utf8");
          } catch {
            failed.push(file);
          }
        }
        if (failed.length)
          throw new Error(`move failed; could not restore: ${failed.join(", ")}`, { cause: error });
        throw error;
      }

      return {
        content: [
          {
            type: "text",
            text: `Successfully ${params.duplicate ? "duplicated" : "moved"} block.`,
          },
        ],
        details: { files: [...changes.keys()] },
      };
    });
  },
});

export default move;
