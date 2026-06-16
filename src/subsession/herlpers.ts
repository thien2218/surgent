import { existsSync } from "node:fs";
import type { AgentAllowList } from "../agent/types.js";

export function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }

  const executableName = currentScript?.split("/").pop()?.toLowerCase() ?? "";
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(executableName);
  if (!isGenericRuntime) {
    return { command: process.execPath, args };
  }

  return { command: "surgent", args };
}

export function allowListUnion(
  request: AgentAllowList | undefined,
  runtime: AgentAllowList | undefined,
) {
  if (request === "all") return runtime;
  if (typeof request === "undefined" || runtime === "all" || typeof runtime === "undefined") {
    return request;
  }
  return [...new Set([...request, ...runtime])];
}

export function safeParseAllowList(value?: string) {
  if (typeof value === "undefined") return value;
  return JSON.parse(value) as AgentAllowList;
}
