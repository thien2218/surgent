const GENERATED_TEXT_PATTERN =
  /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----|\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}|\$argon2(?:id|i|d)\$[^\s$]+\$[^\s$]+\$[^\s$]+\$[^\s$]+|(?:[A-Za-z0-9_-]{10,}\.){2}[A-Za-z0-9_-]{10,}|\b[a-fA-F0-9]{32,128}\b|(?<![A-Za-z0-9+/])(?=[A-Za-z0-9+/]{32,}={0,2}(?![A-Za-z0-9+/]))(?=[A-Za-z0-9+/]*[0-9+/=])[A-Za-z0-9+/]+={0,2}/g;

export function containsGeneratedText(text: string): boolean {
  GENERATED_TEXT_PATTERN.lastIndex = 0;
  return GENERATED_TEXT_PATTERN.test(text);
}

export function redactGeneratedText(text: string): string {
  GENERATED_TEXT_PATTERN.lastIndex = 0;
  return text.replaceAll(GENERATED_TEXT_PATTERN, "<redacted_arbitrary_text>");
}
