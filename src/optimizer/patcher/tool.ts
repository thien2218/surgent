import { chmod, mkdir, readFile, realpath, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import {
  defineTool,
  generateDiffString,
  renderDiff,
  withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  deriveNewContent,
  detectLineEnding,
  joinBom,
  normalizeToLF,
  parsePatch,
  restoreLineEndings,
  splitBom,
} from "./patch.js";
import { renderCallText } from "../../utils.js";
import type { Hunk, FileChange, PatchedFile, PatchPlan, Snapshot, WriteStep } from "./types.js";

const FILE_HEADER = /^\*\*\* (?:Add|Update|Delete) File:\s*(.+)$/gm;
const SUMMARY_CODES = { add: "A", update: "M", move: "M", delete: "D" } as const;

const DESCRIPTION = [
  "Edit files with stripped-down, file-oriented diff format. Wrap file sections in envelope:",
  "",
  "*** Begin Patch",
  "[ one or more file sections ]",
  "*** End Patch",
  "",
  "Each section starts with one of three headers:",
  "",
  "*** Add File: <path> - create file. Every following line is + line (initial contents).",
  "*** Delete File: <path> - remove existing file. Nothing follows.",
  "*** Update File: <path> - patch existing file in place, optionally with rename.",
  "",
  "Example:",
  "",
  "```",
  "*** Begin Patch",
  "*** Add File: hello.txt",
  "+Hello world",
  "*** Update File: src/app.py",
  "*** Move to: src/main.py",
  "@@ def greet():",
  '-print("Hi")',
  '+print("Hello, world!")',
  "*** Delete File: obsolete.txt",
  "*** End Patch",
  "```",
  "",
  "Rules:",
  "- Every section needs Add/Delete/Update header.",
  "- Prefix new lines with `+`, even in new files.",
].join("\n");

function patchTargets(hunks: Hunk[], cwd: string): string[] {
  const targets = hunks.flatMap((hunk) =>
    hunk.type === "update" && hunk.movePath ? [hunk.path, hunk.movePath] : [hunk.path],
  );
  return [...new Set(targets.map((target) => resolve(cwd, target)))];
}

async function lockKeys(targets: string[]): Promise<string[]> {
  const owners = new Map<string, string>();
  for (const target of targets) {
    const key = await realpath(target).catch(() => target);
    // Two names for one file would wait on their own lock or overwrite each other.
    const owner = owners.get(key);
    if (owner) {
      throw new Error(`patch verification failed: ${owner} and ${target} are the same file`);
    }
    owners.set(key, target);
  }
  return [...owners.keys()].sort();
}

function withFileLocks<T>(paths: string[], work: () => Promise<T>): Promise<T> {
  const [first, ...rest] = paths;
  if (!first) return work();
  return withFileMutationQueue(first, () => withFileLocks(rest, work));
}

async function readOriginal(filePath: string): Promise<Snapshot | null> {
  const stats = await stat(filePath).catch(() => undefined);
  if (!stats) return null;
  if (!stats.isFile()) {
    throw new Error(`patch verification failed: Not a regular file: ${filePath}`);
  }

  try {
    return { content: await readFile(filePath), mode: stats.mode };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`patch verification failed: ${message}`);
  }
}

async function readCurrent(plan: PatchPlan, filePath: string): Promise<string | null> {
  if (!plan.files.has(filePath)) {
    const original = await readOriginal(filePath);
    plan.originals.set(filePath, original);
    plan.files.set(filePath, original ? original.content.toString("utf8") : null);
  }
  return plan.files.get(filePath) ?? null;
}

async function planChange(hunk: Hunk, cwd: string, plan: PatchPlan): Promise<FileChange> {
  const filePath = resolve(cwd, hunk.path);

  switch (hunk.type) {
    case "add": {
      const contents =
        hunk.contents.length === 0 || hunk.contents.endsWith("\n")
          ? hunk.contents
          : `${hunk.contents}\n`;
      // Read only so a failed write can restore the file this overwrites.
      await readCurrent(plan, filePath);
      plan.files.set(filePath, contents);
      return { filePath, oldContent: "", newContent: splitBom(contents).text, type: "add" };
    }

    case "update": {
      const current = await readCurrent(plan, filePath);
      if (current === null) {
        throw new Error(`patch verification failed: Failed to read file to update: ${filePath}`);
      }

      const source = splitBom(current);
      const ending = detectLineEnding(source.text);
      const oldContent = normalizeToLF(source.text);
      let newContent: string;
      try {
        newContent = deriveNewContent(filePath, hunk.chunks, oldContent);
      } catch (error) {
        throw new Error(`patch verification failed: ${error}`);
      }

      const movePath = hunk.movePath ? resolve(cwd, hunk.movePath) : undefined;
      if (movePath) {
        await readCurrent(plan, movePath);
        // Removed before the destination is set, so moving a file onto itself keeps it.
        plan.files.set(filePath, null);
      }
      plan.files.set(
        movePath ?? filePath,
        joinBom(restoreLineEndings(newContent, ending), source.bom),
      );

      return {
        filePath,
        oldContent,
        newContent,
        type: movePath ? "move" : "update",
        movePath,
      };
    }

    case "delete": {
      const current = await readCurrent(plan, filePath);
      if (current === null) {
        throw new Error(`patch verification failed: Failed to read file to delete: ${filePath}`);
      }

      plan.files.set(filePath, null);
      const oldContent = normalizeToLF(splitBom(current).text);
      return { filePath, oldContent, newContent: "", type: "delete" };
    }
  }
}

/** Undoes completed steps in reverse and returns the paths it could not restore. */
async function restore(plan: PatchPlan, steps: WriteStep[]): Promise<string[]> {
  const failed: string[] = [];
  for (const step of steps.toReversed()) {
    const original = plan.originals.get(step.filePath);
    try {
      if (original) {
        const content = await readFile(step.filePath).catch(() => undefined);
        // A write that failed before changing the file needs no restore.
        if (!content?.equals(original.content)) {
          await writeFile(step.filePath, original.content);
          await chmod(step.filePath, original.mode);
        }
      } else {
        await rm(step.filePath, { force: true });
      }
    } catch {
      failed.push(step.filePath);
    }

    if (!step.createdDir) continue;
    for (let dir = dirname(step.filePath); dir.startsWith(step.createdDir); dir = dirname(dir)) {
      await rmdir(dir).catch(() => undefined);
    }
  }
  return failed;
}

async function writePlan(plan: PatchPlan) {
  const steps: WriteStep[] = [];
  try {
    for (const [filePath, content] of plan.files) {
      if (content === null) {
        if (!plan.originals.get(filePath)) continue;
        await rm(filePath);
        steps.push({ filePath });
        continue;
      }

      const createdDir = await mkdir(dirname(filePath), { recursive: true });
      steps.push({ filePath, createdDir });
      await writeFile(filePath, content, "utf8");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = await restore(plan, steps);
    if (failed.length > 0) {
      throw new Error(`patch failed: ${message}\nCould not restore: ${failed.join(", ")}`);
    }
    throw new Error(`patch failed, no files were changed: ${message}`);
  }
}

function patchedPaths(patchText: string): string[] {
  return [...patchText.matchAll(FILE_HEADER)].map((match) => match[1]!.trim());
}

export const applyPatch = defineTool({
  name: "patch",
  label: "patch",
  description: DESCRIPTION,
  parameters: Type.Object({
    patchText: Type.String({ description: "Full patch text with all changes" }),
  }),
  async execute(_toolCallId, params, signal, _onUpdate, ctx) {
    if (!params.patchText) {
      throw new Error("patchText is required");
    }

    let hunks: Hunk[];
    try {
      hunks = parsePatch(params.patchText);
    } catch (error) {
      throw new Error(`patch verification failed: ${error}`);
    }

    if (hunks.length === 0) {
      if (normalizeToLF(params.patchText).trim() === "*** Begin Patch\n*** End Patch") {
        throw new Error("patch rejected: empty patch");
      }
      throw new Error("patch verification failed: no hunks found");
    }

    const locks = await lockKeys(patchTargets(hunks, ctx.cwd));
    const changes = await withFileLocks(locks, async () => {
      const plan: PatchPlan = { files: new Map(), originals: new Map() };
      const planned: FileChange[] = [];
      for (const hunk of hunks) {
        planned.push(await planChange(hunk, ctx.cwd, plan));
      }
      signal?.throwIfAborted();
      await writePlan(plan);
      return planned;
    });

    const files: PatchedFile[] = changes.map((change) => ({
      type: change.type,
      path: relative(ctx.cwd, change.movePath ?? change.filePath).replaceAll("\\", "/"),
      diff: generateDiffString(change.oldContent, change.newContent).diff,
    }));
    const summaryLines = files.map((file) => `${SUMMARY_CODES[file.type]} ${file.path}`);

    return {
      content: [
        {
          type: "text",
          text: `Success. Updated the following files:\n${summaryLines.join("\n")}`,
        },
      ],
      details: { files },
    };
  },
  renderCall(args, theme, { isPartial }) {
    const paths = typeof args.patchText === "string" ? patchedPaths(args.patchText) : [];
    return renderCallText(
      `${theme.fg("toolTitle", "patch")} ${theme.fg("accent", paths.join(", "))}`,
      isPartial,
    );
  },
  renderResult(result, _options, theme, context) {
    if (context.isError) {
      const output = result.content[0];
      return new Text(theme.fg("error", output?.type === "text" ? output.text : ""), 0, 0);
    }

    const { files = [] } = (result.details ?? {}) as { files?: PatchedFile[] };
    const blocks = files.map(
      (file) =>
        `${theme.fg("toolTitle", `${SUMMARY_CODES[file.type]} ${file.path}`)}\n${renderDiff(file.diff)}`,
    );
    return new Text(blocks.join("\n\n"), 0, 0);
  },
});
