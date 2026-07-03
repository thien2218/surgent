import { SECRET_PATTERNS } from "./patterns.js";

const ENTROPY_THRESHOLDS = { hex: 3.2, b64: 4.2, any: 3.8 };
const ENTROPY_SECRET_PATTERN =
  /(?:token|secret|key|password|credential|auth|api|private)[_\-]?[a-z]*["']?\s*[:=]\s*["']?([A-Za-z0-9+\/=_\-]{20,120})/gi;

function shannonEntropy(value: string): number {
  const freq = new Map<string, number>();
  for (const char of value) {
    freq.set(char, (freq.get(char) ?? 0) + 1);
  }

  let h = 0;
  for (const count of freq.values()) {
    const p = count / value.length;
    h -= p * Math.log2(p);
  }

  return h;
}

function isHighEntropy(value: string, minLen = 20): boolean {
  if (value.length < minLen) return false;
  const ent = shannonEntropy(value);
  if (/^[0-9a-fA-F]+$/.test(value)) return ent > ENTROPY_THRESHOLDS.hex;
  if (/^[A-Za-z0-9+/=_\-]+$/.test(value)) return ent > ENTROPY_THRESHOLDS.b64;
  return ent > ENTROPY_THRESHOLDS.any;
}

function isFalsePositive(value: string): boolean {
  const normalized = value.toLowerCase().trim();
  if (/^[a-z_\-]+$/.test(normalized)) return true;
  if (/^[\d.]+$/.test(normalized)) return true;
  if (new Set(normalized.replace(/[-_]/g, "")).size < 3) return true;
  return false;
}

// Sub-milisecond overhead
export function containSecrets(input: string): boolean {
  for (const { pattern, severe } of SECRET_PATTERNS) {
    const match = pattern.exec(input);
    if (!match) continue;
    const value = match[1] ?? match[0];
    if (value.length < 8 || isFalsePositive(value) || (!severe && !isHighEntropy(value))) continue;
    return true;
  }

  let match: RegExpExecArray | null;
  ENTROPY_SECRET_PATTERN.lastIndex = 0;

  while ((match = ENTROPY_SECRET_PATTERN.exec(input)) !== null) {
    const value = match[1] ?? "";
    if (value && !isFalsePositive(value) && isHighEntropy(value)) return true;
  }

  return false;
}

export function replaceSecrets(input: string): string {
  const replacements: Array<{ start: number; end: number }> = [];

  for (const { pattern, severe } of SECRET_PATTERNS) {
    const globalPattern = new RegExp(
      pattern.source,
      pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`
    );
    let match: RegExpExecArray | null;

    while ((match = globalPattern.exec(input)) !== null) {
      const value = match[1] ?? match[0];
      if (value.length < 8 || isFalsePositive(value) || (!severe && !isHighEntropy(value))) continue;

      if (match[1]) {
        const capturedValueOffset = match[0].indexOf(match[1]);
        if (capturedValueOffset >= 0) {
          replacements.push({
            start: match.index + capturedValueOffset,
            end: match.index + capturedValueOffset + match[1].length,
          });
          continue;
        }
      }

      replacements.push({ start: match.index, end: match.index + match[0].length });
    }
  }

  let entropyMatch: RegExpExecArray | null;
  ENTROPY_SECRET_PATTERN.lastIndex = 0;
  while ((entropyMatch = ENTROPY_SECRET_PATTERN.exec(input)) !== null) {
    const value = entropyMatch[1] ?? "";
    if (!value || isFalsePositive(value) || !isHighEntropy(value)) continue;

    const capturedValueOffset = entropyMatch[0].indexOf(value);
    if (capturedValueOffset < 0) continue;

    replacements.push({
      start: entropyMatch.index + capturedValueOffset,
      end: entropyMatch.index + capturedValueOffset + value.length,
    });
  }

  let redacted = input;
  let nextAppliedStart = input.length + 1;
  for (const replacement of replacements.sort((first, second) => second.start - first.start)) {
    if (replacement.end > nextAppliedStart) continue;
    redacted = `${redacted.slice(0, replacement.start)}...${redacted.slice(replacement.end)}`;
    nextAppliedStart = replacement.start;
  }

  return redacted;
}
