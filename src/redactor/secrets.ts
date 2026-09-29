import { SECRET_PATTERNS } from "./patterns.js";

const ENTROPY_THRESHOLDS = { hex: 3.2, b64: 4.2, any: 3.8 };

function shannonEntropy(value: string): number {
  const characterFrequencies = new Map<string, number>();
  for (const character of value) {
    characterFrequencies.set(character, (characterFrequencies.get(character) ?? 0) + 1);
  }

  let entropy = 0;
  for (const count of characterFrequencies.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }

  return entropy;
}

function isHighEntropy(value: string, minimumLength = 20): boolean {
  if (value.length < minimumLength) return false;
  const entropy = shannonEntropy(value);
  if (/^[0-9a-fA-F]+$/.test(value)) return entropy > ENTROPY_THRESHOLDS.hex;
  if (/^[A-Za-z0-9+/=_\-]+$/.test(value)) return entropy > ENTROPY_THRESHOLDS.b64;
  return entropy > ENTROPY_THRESHOLDS.any;
}

function isFalsePositive(value: string): boolean {
  const normalized = value.toLowerCase().trim();
  if (/^[a-z_\-]+$/.test(normalized)) return true;
  if (/^[\d.]+$/.test(normalized)) return true;
  if (new Set(normalized.replace(/[-_]/g, "")).size < 3) return true;
  return false;
}

// Sub-milisecond overhead
function* secretRanges(input: string): Generator<[number, number]> {
  for (const { pattern, severe } of SECRET_PATTERNS) {
    const flags = [...new Set(`${pattern.flags}dg`)].join("");
    for (const match of input.matchAll(new RegExp(pattern.source, flags))) {
      const value = match[1] ?? match[0];
      if (!severe && (isFalsePositive(value) || !isHighEntropy(value))) continue;
      // The d flag provides offsets for the actual capture, even if its text repeats.
      yield match.indices![match[1] === undefined ? 0 : 1]!;
    }
  }
}

export function containSecrets(input: string): boolean {
  return !secretRanges(input).next().done;
}

export function replaceSecrets(input: string): string {
  const ranges: Array<[number, number]> = [];
  for (const [start, end] of [...secretRanges(input)].sort(([first], [second]) => first - second)) {
    const previous = ranges.at(-1);
    if (previous && start < previous[1]) {
      previous[1] = Math.max(previous[1], end);
    } else {
      ranges.push([start, end]);
    }
  }

  let redacted = input;
  for (const [start, end] of ranges.reverse()) {
    redacted = `${redacted.slice(0, start)}(redacted texts)${redacted.slice(end)}`;
  }
  return redacted;
}
