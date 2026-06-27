import type { AgentMeta } from "./types.js";
import type { FieldDefinition, FormConfig } from "../ui/components/form.js";

const META_FIELDS: readonly (keyof AgentMeta)[] = [
  "description",
  "model",
  "tools",
  "mcp_servers",
  "skills",
  "bash",
  "files",
];

export function getAgentConfigForm(agent: string, meta: AgentMeta): FormConfig<AgentMeta> {
  return {
    title: `Edit agent config: ${agent}`,
    fields: META_FIELDS.map((field): FieldDefinition => {
      const value = meta[field];
      return {
        key: field,
        label: field,
        placeholder:
          field === "description"
            ? "Describe what this agent does (not included in system prompt)"
            : field === "model"
              ? "AI model to use for this agent (blank inherits from session)"
              : `Comma-separated allowed ${field}, or none`,
        initialText: Array.isArray(value) ? value.join(", ") : (value ?? ""),
        labelWidth: 32,
      };
    }),
    emptyMessage: "No metadata fields available for editing.",
    parseOnSave: (values) => {
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

        const normalizedValue = rawValue.trim();
        if (!normalizedValue) {
          continue;
        }
        if (normalizedValue === "none") {
          updatedMeta[field] = "none";
          continue;
        }

        const entries = normalizedValue
          .split(",")
          .map((entry) => entry.trim().replace(/^['\"]|['\"]$/g, ""))
          .filter(Boolean);
        if (entries.length > 0) {
          updatedMeta[field] = entries;
        }
      }

      return updatedMeta;
    },
  };
}
