import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveReadGrant } from "../../permission/resolution.js";
import { runCommand } from "../../utils.js";
import type { FileCheck } from "../../permission/types.js";
import { getState } from "../../state.js";
import { askForPermission } from "../../permission/index.js";

async function findFiles(
  cwd: string,
  paths: string[],
  patterns: string[] = [],
  signal?: AbortSignal,
) {
  // Filenames can also be `find` predicates; keep those paths literal.
  const args = paths.map((path) =>
    path.startsWith("-") || ["!", "(", ")", ","].includes(path) ? `./${path}` : path,
  );
  args.push("-type", "f");

  if (patterns.length > 0) {
    args.push("(");
    for (const [index, pattern] of patterns.entries()) {
      if (index > 0) args.push("-o");
      args.push("-path", pattern);
    }
    args.push(")");
  }
  args.push("-print0");

  const result = await runCommand(cwd, "find", args, {
    signal,
    abortMessage: "Tool call aborted",
  });

  return result.stdout
    .split("\0")
    .filter(Boolean)
    .map((path) => path.replaceAll("\\", "/").replace(/\/+$/, ""));
}

export async function resolveTargetPaths(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  paths: string[],
  patterns?: string[],
  signal?: AbortSignal,
) {
  const state = getState(pi);
  const allowed: string[] = [];
  const files = await findFiles(ctx.cwd, paths, patterns, signal);
  let check: FileCheck | undefined;
  let denied = false;

  for (const file of files) {
    signal?.throwIfAborted();
    const grant = await resolveReadGrant(file, state, ctx);
    if (grant.denied.length > 0) {
      denied = true;
      continue;
    }

    allowed.push(file);
    if (grant.check) {
      check ??= grant.check;
      check.raw += `\n${grant.check.absolute}`;
    }
  }

  if (allowed.length === 0) {
    throw new Error("(no read-authorized files found)");
  }
  if (check && getState(pi).getMode() !== "yolo") {
    const decision = await askForPermission(pi, ctx, check);
    if (decision?.block) throw new Error(decision.reason);
  }

  return { files: allowed, denied };
}
