import { SECRET_PATTERNS } from "./patterns.js";

const ENTROPY_THRESHOLDS = { hex: 3.2, b64: 4.2, any: 3.8 };

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

  const entropyRe =
    /(?:token|secret|key|password|credential|auth|api|private)[_\-]?[a-z]*["']?\s*[:=]\s*["']?([A-Za-z0-9+\/=_\-]{20,120})/gi;
  let match: RegExpExecArray | null;

  while ((match = entropyRe.exec(input)) !== null) {
    const value = match[1] ?? "";
    if (value && !isFalsePositive(value) && isHighEntropy(value)) return true;
  }

  return false;
}
