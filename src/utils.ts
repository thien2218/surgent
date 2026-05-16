export function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

export function tokenizeArgs(args: string): string[] {
  return args
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
}
