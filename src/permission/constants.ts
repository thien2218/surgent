export const SCOPES = ["session", "project", "always"] as const;

export const PERMISSIVE_TOOLS = {
  read: { category: "file", op: "read" },
  write: { category: "file", op: "write" },
  edit: { category: "file", op: "write" },
  bash: { category: "bash" },
  web_fetch: { category: "web" },
} as const;

export const SCOPE_LABELS = {
  session: "in this session",
  project: "in this project",
  always: "always",
} as const;

export const SUSPICIOUS_BASH_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // Command injection syntax
  { pattern: /\$\(/, reason: "Command substitution $(...)" },
  { pattern: /`[^`]+`/, reason: "Backtick command substitution" },
  { pattern: /\$\{[^}]*}/, reason: "Variable/command expansion ${...}" },

  // Inline shell execution
  { pattern: /\|\s*(?:bash|sh|zsh|fish|ksh|csh)/, reason: "Pipe into shell" },
  { pattern: /(?:bash|sh|zsh)\s+-c/, reason: "Inline shell execution" },
  { pattern: /\beval\b/, reason: "eval" },
  { pattern: /\bexec\b/, reason: "exec" },

  // Remote fetch
  { pattern: /\bcurl\s/, reason: "Potential remote execution with curl" },
  { pattern: /\bwget\s/, reason: "Potential remote execution with wget" },
  { pattern: /\bfetch\s/, reason: "Potential remote execution with fetch" },

  // Reverse shell / network tricks
  { pattern: /\/dev\/tcp/, reason: "Bash TCP redirect" },
  { pattern: /\/dev\/udp/, reason: "Bash UDP redirect" },
  { pattern: /\bnc\b/, reason: "netcat" },
  { pattern: /\bncat\b/, reason: "ncat" },
  { pattern: /\bsocat\b/, reason: "socat" },

  // Obfuscation
  { pattern: /\$'[^']*'/, reason: "ANSI-C quoting (possible obfuscation)" },
  { pattern: /\$\(\(/, reason: "arithmetic expansion" },
  { pattern: /\bbase64\b/, reason: "base64 (possible encoded payload)" },
  { pattern: /\\x[0-9a-f]{2}/i, reason: "Hex escape sequence" },
  { pattern: /\\u[0-9a-f]{4}/i, reason: "Unicode escape sequence" },

  // Privilege escalation
  { pattern: /\bsudo\b/, reason: "Privilege escalation with sudo" },
  { pattern: /\bsu\b/, reason: "Privilege escalation with su" },
];
