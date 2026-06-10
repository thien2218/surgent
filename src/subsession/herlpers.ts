import { existsSync } from "node:fs";

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

export function filterSubsessionTools(toolNames: string[]): string[] {
  const stripped = new Set(["bash", "subagent", "questionnaire", "permission"]);
  const safeTools: string[] = [];
  const seenTools = new Set<string>();

  for (const toolName of toolNames) {
    if (stripped.has(toolName)) continue;
    if (seenTools.has(toolName)) continue;
    seenTools.add(toolName);
    safeTools.push(toolName);
  }

  return safeTools;
}
