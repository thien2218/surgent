import type { AgentMeta } from "./types.js";
import type { FormConfig } from "../ui/components/form.js";

const META_FIELDS: readonly (keyof AgentMeta)[] = [
  "description",
  "model",
  "thinking_level",
  "tools",
  "mcp_servers",
  "skills",
  "bash",
  "files",
];

function parseConfigValues(values: Record<string, string>) {
  const description = (values.description ?? "").trim();
  if (!description) {
    throw new Error("Description cannot be empty.");
  }

  const updated: AgentMeta = { description };
  for (const field of META_FIELDS) {
    if (field === "description") continue;

    const rawValue = values[field] ?? "";
    if (field === "model") {
      const modelValue = rawValue.trim();
      if (modelValue) {
        updated.model = modelValue;
      }
      continue;
    }
    if (field === "thinking_level") {
      const thinkingLevel = rawValue.trim();
      if (
        thinkingLevel &&
        !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(thinkingLevel)
      ) {
        throw new Error("Thinking level must be off, minimal, low, medium, high, xhigh, or max.");
      }
      if (thinkingLevel) {
        updated.thinking_level = thinkingLevel as AgentMeta["thinking_level"];
      }
      continue;
    }

    const normalizedValue = rawValue.trim();
    if (!normalizedValue) continue;
    if (normalizedValue === "none") {
      updated[field] = "none";
      continue;
    }

    const entries = normalizedValue
      .split(",")
      .map((entry) => entry.trim().replace(/^['\"]|['\"]$/g, ""))
      .filter(Boolean);
    if (entries.length > 0) {
      updated[field] = entries;
    }
  }

  return updated;
}

export function getAgentConfigForm(agent: string, meta: AgentMeta): FormConfig<AgentMeta> {
  return {
    title: `Edit agent config: ${agent}`,
    fields: META_FIELDS.map((field) => {
      const value = meta[field];
      let placeholder: string;
      if (field === "description") {
        placeholder = "Describe what this agent does (not included in system prompt)";
      } else if (field === "model") {
        placeholder = "AI model to use for this agent (leave blank to inherit)";
      } else if (field === "thinking_level") {
        placeholder = "off, minimal, low, medium, high, xhigh, or max (leave blank to inherit)";
      } else {
        placeholder = `Comma-separated allowed ${field}, or none`;
      }

      return {
        key: field,
        label: field,
        labelWidth: 32,
        mode: {
          type: "input",
          placeholder,
          text: Array.isArray(value) ? value.join(", ") : (value ?? ""),
        },
      };
    }),
    emptyMessage: "No metadata fields available for editing.",
    parseOnSave: parseConfigValues,
  };
}
