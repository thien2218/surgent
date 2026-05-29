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
