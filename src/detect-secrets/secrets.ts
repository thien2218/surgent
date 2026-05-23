import { SECRET_PATTERNS } from "./patterns.js";

const ENTROPY_THRESHOLDS = { hex: 3.2, b64: 4.2, any: 3.8 };

const FP_BLACKLIST = new Set([
  "example",
  "placeholder",
  "your_key_here",
  "insert_key",
  "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "aaaaaaaaaaaaaaaaaaaaaaaa",
  "0000000000000000000000000000000",
  "null",
  "undefined",
  "name@example.com",
  "127.0.0.1",
  "localhost",
  "test",
  "demo",
  "changeme",
  "password",
  "secret",
  "token",
  "api_key",
  "apikey",
  "your_secret_here",
  "enter_key_here",
  "add_your_key",
]);

function shannonEntropy(value: string): number {
  const freq = new Map<string, number>();
  for (const ch of value) freq.set(ch, (freq.get(ch) ?? 0) + 1);
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
  if (FP_BLACKLIST.has(normalized)) return true;
  if (new Set(normalized).size < 4) return true;
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
    if (value.length < 8) continue;
    if (isFalsePositive(value)) continue;
    if (!severe && !isHighEntropy(value)) continue;
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
