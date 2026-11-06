import { readLanguages, SHARED_KINDS, type LanguageSymbol } from "../grammar/index.js";

export async function loadKindsPrompt(cwd: string) {
  const languages = (await readLanguages(cwd)) ?? [];
  const list = languages.map(({ name, profile }) => `- ${name}: ${profile.extraKinds.join(", ")}`);
  return [
    "Values for code_map `kinds`, by language. Shared kinds apply to all languages.",
    `- shared: ${SHARED_KINDS.join(", ")}`,
    ...list,
  ].join("\n");
}

export function formatRange([start, end]: [number, number]) {
  return start === end ? `L${start}` : `L${start}-L${end}`;
}

export function formatSymbols(symbols: LanguageSymbol[]) {
  const lines: string[] = [];
  let parent: LanguageSymbol | undefined;
  let runKey: string | undefined;

  for (const [index, symbol] of symbols.entries()) {
    if (symbol.path !== symbols[index - 1]?.path) {
      lines.push(symbol.path);
      parent = undefined;
      runKey = undefined;
    }

    const isNested = !!symbol.container && symbol.container === parent?.baseName;
    if (!isNested) parent = symbol.container ? undefined : symbol;
    const next = symbols[index + 1];
    const opensParent =
      parent === symbol && next?.path === symbol.path && next.container === symbol.baseName;
    const isGroup = symbol.kind === "import" || symbol.kind === "export";
    const qualifier = isNested ? `${symbol.container}.` : "";
    const entry = `${symbol.name.slice(qualifier.length)} ${formatRange(symbol.range)}`;
    const key = isGroup ? undefined : `${isNested} ${symbol.kind}`;

    if (key && key === runKey && !opensParent) {
      lines[lines.length - 1] += `; ${entry}`;
    } else {
      const indent = isNested ? "  " : " ";
      lines.push(isGroup ? `${indent}${entry}` : `${indent}[${symbol.kind}] ${entry}`);
    }
    runKey = key;
  }
  return lines;
}
