interface Span {
  start: number;
  end: number;
}

function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/[\u00a0\u2002-\u200a\u202f\u205f\u3000]/g, " ");
}

function view(content: string, fuzzy: boolean) {
  let text = "";
  const spans: Span[] = [];
  const lines = content.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? [];
  let offset = 0;

  for (const line of lines) {
    const ending = line.match(/\r\n$|[\r\n]$/)?.[0] ?? "";
    const body = line.slice(0, line.length - ending.length);
    const kept = fuzzy ? body.trimEnd() : body;
    let position = offset;

    for (const character of kept) {
      const normalized = fuzzy ? normalize(character) : character;
      text += normalized;
      for (let index = 0; index < normalized.length; index++) {
        spans.push({ start: position, end: position + character.length });
      }
      position += character.length;
    }

    if (ending) {
      text += "\n";
      spans.push({ start: offset + body.length, end: offset + line.length });
    }

    offset += line.length;
  }

  return { text, spans };
}

export function findAnchor(
  content: string,
  anchor: string,
  label: string,
  after = 0,
  first = false,
): Span {
  if (!anchor) throw new Error(`${label} must not be empty`);
  const matches: Span[] = [];
  for (const fuzzy of [false, true]) {
    const base = view(content.slice(after), fuzzy);
    const needle = view(anchor, fuzzy).text;
    if (!needle) throw new Error(`${label} must not be empty after normalization`);

    const index = base.text.indexOf(needle);
    if (index === -1) continue;
    if (!first && base.text.indexOf(needle, index + 1) !== -1) {
      throw new Error(`${label} is ambiguous; provide more context`);
    }

    matches.push({
      start: after + base.spans[index]!.start,
      end: after + base.spans[index + needle.length - 1]!.end,
    });
  }
  if (matches.length) {
    if (!first) return matches[0]!;
    return matches.reduce((earliest, match) => match.start < earliest.start ? match : earliest);
  }
  throw new Error(`${label} was not found`);
}
