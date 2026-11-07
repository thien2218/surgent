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

function findMatches(
  content: string,
  anchor: string,
  label: string,
  after = 0,
  before = content.length,
): Span[][] {
  if (!anchor) throw new Error(`${label} must not be empty`);
  const matches: Span[][] = [];

  for (const fuzzy of [false, true]) {
    const base = view(content.slice(after, before), fuzzy);
    const needle = view(anchor, fuzzy).text;
    if (!needle) continue;

    const found: Span[] = [];
    let index = base.text.indexOf(needle);
    while (index !== -1) {
      found.push({
        start: after + base.spans[index]!.start,
        end: after + base.spans[index + needle.length - 1]!.end,
      });
      index = base.text.indexOf(needle, index + 1);
    }
    matches.push(found);
  }

  return matches;
}

export function findAnchor(
  content: string,
  anchor: string,
  label: string,
  after = 0,
  first = false,
): Span {
  const matches = findMatches(content, anchor, label, after);
  if (!first && matches.some((found) => found.length > 1)) {
    throw new Error(`${label} is ambiguous; provide more context`);
  }
  const candidates = matches.flat();
  if (candidates.length) {
    if (!first) return candidates[0]!;
    return candidates.reduce((earliest, match) => (match.start < earliest.start ? match : earliest));
  }

  throw new Error(`${label} was not found`);
}

export function findRange(content: string, startAnchor: string, endAnchor: string, label: string): Span {
  const matches = findMatches(content, startAnchor, `${label}.start`);
  const starts = matches.flat();
  if (!starts.length) throw new Error(`${label}.start was not found`);
  if (matches.every((found) => found.length <= 1)) {
    const start = starts[0]!;
    const end = findAnchor(content, endAnchor, `${label}.end`, start.end, true);
    return { start: start.start, end: end.end };
  }

  const end = findAnchor(content, endAnchor, `${label}.end`);
  const preceding = findMatches(content, startAnchor, `${label}.start`, 0, end.start).flat();
  if (!preceding.length) throw new Error(`${label}.start was not found before end`);
  const start = preceding.reduce((nearest, match) => (match.start > nearest.start ? match : nearest));
  return { start: start.start, end: end.end };
}
