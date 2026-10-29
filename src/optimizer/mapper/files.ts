import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { resolveReadGrant } from "../../permission/resolution.js";
import { runCommand } from "../../utils.js";
import type { FileCheck } from "../../permission/types.js";
import { getState } from "../../state.js";
import { askForPermission } from "../../permission/index.js";
import { getSupportedExtensions } from "../grammar/index.js";

function normalizePath(path: string) {
  return path.replaceAll("\\", "/").replace(/\/+$/, "");
}

async function listDirectory(cwd: string, dirs: string[], glob?: string, signal?: AbortSignal) {
  if (dirs.length === 0) return { files: [], failed: [] };
  const localPath = join(getAgentDir(), "bin", process.platform === "win32" ? "rg.exe" : "rg");
  const cmd = existsSync(localPath) ? localPath : "rg";
  const args = ["--no-config", "--files", "--hidden", "--glob", "!.{git,pi}"];
  if (glob) args.push("--glob", glob);
  args.push("--", ...dirs);

  const result = await runCommand(cwd, cmd, args, {
    signal,
    successExitCodes: [0, 1, 2],
  });
  return {
    files: result.stdout.split("\n").filter(Boolean),
    failed: result.stderr.trim().split("\n").filter(Boolean),
  };
}

async function findFiles(cwd: string, paths: string[], glob?: string, signal?: AbortSignal) {
  const supported = getSupportedExtensions();
  const files = new Set<string>();
  const dirs: string[] = [];
  const failed: string[] = [];

  for (const path of paths) {
    signal?.throwIfAborted();
    const stats = await stat(resolve(cwd, path)).catch(() => undefined);
    if (!stats) {
      failed.push(`${path}: no such file or directory`);
      continue;
    }
    if (!stats.isDirectory()) {
      files.add(normalizePath(path));
      continue;
    }
    dirs.push(path);
  }

  const listed = await listDirectory(cwd, dirs, glob, signal);
  for (const file of listed.files) {
    if (supported.has(extname(file).toLowerCase())) {
      files.add(normalizePath(file));
    }
  }
  failed.push(...listed.failed);

  return { files, failed };
}

export async function resolveTargetPaths(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  paths: string[],
  glob?: string,
  signal?: AbortSignal,
) {
  const state = getState(pi);
  const allowed: string[] = [];
  const { files, failed } = await findFiles(ctx.cwd, paths, glob, signal);
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

  if (allowed.length === 0 && (files.size > 0 || failed.length === 0)) {
    throw new Error("(no read-authorized files found)");
  }
  if (check && getState(pi).getMode() !== "yolo") {
    const decision = await askForPermission(pi, ctx, check);
    if (decision?.block) throw new Error(decision.reason);
  }

  return { files: allowed, denied, failed };
}
