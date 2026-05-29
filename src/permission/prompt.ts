import { type TUI } from "@earendil-works/pi-tui";
import type { PromptDecision, PermCheck } from "./types.js";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Frame } from "../ui/components/frame.js";

type PromptOptions = {
  label: string;
  value: PromptDecision;
  persists: boolean; // true will trigger write to storage when selected
  separator?: string;
};

// TODO

export default class PermissionPrompt extends Frame {
  private cursor: number = 0;
  private amending: boolean = false;
  private readonly options: PromptOptions[] = [
    { label: "Yes", separator: ",", value: { allowed: true }, persists: false },
    { label: "No", separator: ",", value: { allowed: false }, persists: false },
  ];

  onDone?: (decision: PromptDecision) => void;

  constructor(
    private readonly tui: TUI,
    protected theme: Theme,
    private readonly check: PermCheck,
  ) {
    super(theme);
  }

  /**
   * This component should:
   * - Prompt user if they want to allow tool call to be made
   * - Handle read and write to storage accordingly
   *
   * Content to display in frame:
   * ```
   * bold(Allow agent to call {category} tool {toolName}: {expr_truncated_to_first_50_chars})
   *
   * 1. Yes
   * 2. No
   * 3. Yes, allow {toolName} [{SCOPE_LABELS[scope]}] for: {expr}
   * 4. No, disallow {toolName} [{SCOPE_LABELS[scope]}] for: {expr}
   * ```
   *
   * Key bindings:
   * - Shift+Tab => cycle scope in SCOPES
   * - Enter => selects option
   * - Up/down arrow => change selection
   * - Tab => allow user to amend the answer by typing. amendment looks like this:
   * ```
   * 1. Yes, {input}
   * 2. No, {input}
   * 3. Yes, allow <tool> [{SCOPE_LABELS[scope]}] for: {input_with_expr_as_default}
   * 4. No, disallow <tool> [{SCOPE_LABELS[scope]}] for: {input_with_expr_as_default}
   * ```
   *
   * Rules:
   * - Options 3 & 4 fallback to original expr if left empty
   * - Option 3 is only shown when expr is not empty
   * - Option 4 is only shown when expr is not empty AND expr is not present in rules storage
   */
}
