import { isUtf8 } from "node:buffer";
import { readFile, writeFile } from "node:fs/promises";
import { defineTool, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { findAnchor, findRange } from "../mover/match.js";
import { normalizeToolPath } from "../../../utils.js";

const patchSchema = Type.Object({
  file: Type.String({ description: "Existing file, relative to cwd or absolute" }),
  edits: Type.Array(
    Type.Union([
      Type.Object(
        {
          start: Type.String({
            description: "Literal start anchor, included; start or end must be unique",
            minLength: 1,
          }),
          end: Type.String({
            description: "Literal end anchor, included. Unique start selects first end after it; otherwise unique end selects nearest start before it",
            minLength: 1,
          }),
          text: Type.String({ description: "Replacement text; empty deletes the range" }),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          appendTo: Type.String({
            description: "Unique literal anchor to insert immediately after",
            minLength: 1,
          }),
          text: Type.String({ description: "Text to insert verbatim" }),
        },
        { additionalProperties: false },
      ),
    ]),
    { minItems: 1 },
  ),
});

export type PatchInput = Static<typeof patchSchema>;

const patch = defineTool({
  name: "patch",
  label: "patch",
  description:
    "Edit file using boundary anchors instead of reproducing old text.",
  parameters: patchSchema,
  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    signal?.throwIfAborted();
    if (!params.edits.length) throw new Error("patch requires at least one edit");
    const file = normalizeToolPath(params.file, ctx.cwd);

    return withFileMutationQueue(file, async () => {
      signal?.throwIfAborted();
      const bytes = await readFile(file);
      if (!isUtf8(bytes)) throw new Error("patch requires a UTF-8 text file");
      const original = bytes.toString("utf8");
      const changes = params.edits
        .map((edit, index) => {
          const label = `edits[${index}]`;
          if ("appendTo" in edit) {
            const position = findAnchor(original, edit.appendTo, `${label}.appendTo`).end;
            return { start: position, end: position, text: edit.text };
          }
          const range = findRange(original, edit.start, edit.end, label);
          return { ...range, text: edit.text };
        })
        .sort((left, right) => left.start - right.start || left.end - right.end);

      for (let index = 1; index < changes.length; index++) {
        const previous = changes[index - 1]!;
        const current = changes[index]!;
        if (previous.end > current.start) {
          throw new Error("Edits overlap: replacement ranges and interior insertions conflict");
        }
        if (
          previous.start === previous.end &&
          current.start === current.end &&
          previous.start === current.start
        ) {
          throw new Error("Insertions at the same position conflict");
        }
      }

      let updated = "";
      let offset = 0;
      for (const change of changes) {
        updated += original.slice(offset, change.start) + change.text;
        offset = change.end;
      }
      updated += original.slice(offset);

      signal?.throwIfAborted();
      try {
        // Complete writing or restoration under the queue even if cancelled.
        await writeFile(file, updated, "utf8");
      } catch (error) {
        try {
          await writeFile(file, bytes);
        } catch (restoreError) {
          throw new AggregateError(
            [error, restoreError],
            `patch failed; could not restore: ${file}`,
          );
        }
        throw error;
      }

      return {
        content: [{ type: "text", text: `Successfully patched ${params.file}.` }],
        details: { files: [file] },
      };
    });
  },
});

export default patch;
