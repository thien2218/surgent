import { existsSync } from "node:fs";

const MARKDOWN_HEADING_PATTERN = /^\s*#\s+(.+?)\s*$/m;

export function extractSubsessionTitle(output: string): string | undefined {
  const headingMatch = output.match(MARKDOWN_HEADING_PATTERN);
  if (!headingMatch) {
    return;
  }

  const headingText = headingMatch[1]?.trim();
  if (!headingText) {
    return;
  }

  const separatorIndex = headingText.indexOf(":");
  const titleText =
    separatorIndex >= 0 ? headingText.slice(separatorIndex + 1).trim() : headingText;

  if (!titleText) {
    return;
  }
  return titleText;
}

export function getSurgentInvoker(args: string[]): { command: string; args: string[] } {
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
