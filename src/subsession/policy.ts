export const STRIPPED_TOOLS = new Set(["bash", "subagent", "questionnaire", "permission"]);

export function resolveChildTools(allAvailable: string[], frontmatterTools?: string[]): string[] {
  const ceiling = frontmatterTools
    ? allAvailable.filter((tool) => frontmatterTools.includes(tool))
    : allAvailable;
  return ceiling.filter((tool) => !STRIPPED_TOOLS.has(tool));
}

export function resolveAllowedFiles(perRunFiles: string[], frontmatterFiles?: string[]): string[] {
  if (!frontmatterFiles || frontmatterFiles.length === 0) return perRunFiles;
  return perRunFiles.filter((file) =>
    frontmatterFiles.some((ceiling) => file.startsWith(ceiling) || ceiling.startsWith(file)),
  );
}
