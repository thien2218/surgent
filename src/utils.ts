export function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
