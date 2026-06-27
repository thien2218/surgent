import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import type { AgentAllowList, AgentMeta } from "./types.js";
import { Form, type FieldDefinition } from "../ui/components/form.js";

const ALLOW_LIST_FIELDS = ["tools", "mcp_servers", "skills", "bash", "files"] as const;

type AllowListField = (typeof ALLOW_LIST_FIELDS)[number];

const ALLOW_LIST_KEYS = new Set<AllowListField>(ALLOW_LIST_FIELDS);
const META_FIELDS: (keyof AgentMeta)[] = ["description", "model", ...ALLOW_LIST_FIELDS];

function isAllowListField(field: keyof AgentMeta): field is AllowListField {
  return ALLOW_LIST_KEYS.has(field as AllowListField);
}

function parseAllowListInput(value: string): AgentAllowList | undefined {
  const normalizedValue = value.trim();
  if (!normalizedValue) return undefined;
  if (normalizedValue === "none") return "none";

  const entries = normalizedValue
    .split(",")
    .map((entry) => entry.trim().replace(/^['\"]|['\"]$/g, ""))
    .filter(Boolean);

  return entries.length > 0 ? entries : undefined;
}

function parseMetaFields(values: Record<string, string>): AgentMeta {
  const description = (values.description ?? "").trim();
  if (!description) {
    throw new Error("Description cannot be empty.");
  }

  const updatedMeta: AgentMeta = { description };

  for (const field of META_FIELDS) {
    if (field === "description") {
      continue;
    }

    const rawValue = values[field] ?? "";

    if (field === "model") {
      const modelValue = rawValue.trim();
      if (modelValue) {
        updatedMeta.model = modelValue;
      }
      continue;
    }

    if (isAllowListField(field)) {
      const allowList = parseAllowListInput(rawValue);
      if (allowList !== undefined) {
        updatedMeta[field] = allowList;
      }
    }
  }

  return updatedMeta;
}

function getMetaPlaceholder(field: keyof AgentMeta): string {
  if (field === "description") {
    return "Describe what this agent does (not included in system prompt)";
  }
  if (field === "model") {
    return "AI model to use for this agent (blank inherits from session)";
  }
  return `Comma-separated allowed ${field}, or none`;
}

function stringifyMetaFieldValue(meta: AgentMeta, field: keyof AgentMeta): string {
  const value = meta[field];
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  return value ?? "";
}

function toFormFields(meta: AgentMeta): FieldDefinition[] {
  return META_FIELDS.map((field) => ({
    key: field,
    label: field,
    placeholder: getMetaPlaceholder(field),
    initialValue: stringifyMetaFieldValue(meta, field),
    labelWidth: 32,
  }));
}

export class AgentConfigEditor extends Form<AgentMeta> {
  constructor(
    tui: TUI,
    keybindings: KeybindingsManager,
    theme: Theme,
    agent: string,
    meta: AgentMeta,
  ) {
    super(tui, keybindings, theme, {
      title: `Edit agent config: ${agent}`,
      fields: toFormFields(meta),
      emptyMessage: "No metadata fields available for editing.",
      parseOnSave: parseMetaFields,
    });
  }
}
