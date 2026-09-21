import { describe, expect, it, vi } from "vitest";
import PermissionPrompt from "../../../../src/permission/components/prompt.js";
import { createPermissionCheck } from "../../../helpers/permission.js";
import { testKey, testTheme } from "../../../helpers/tui.js";

describe("PermissionPrompt", () => {
  it("allows the selected one-shot decision", () => {
    const prompt = new PermissionPrompt(testTheme, createPermissionCheck(), process.cwd());
    const onDone = vi.fn();
    prompt.onDone = onDone;

    prompt.handleInput(testKey.enter);

    expect(onDone).toHaveBeenCalledWith({ allowed: true });
  });

  it("denies when No is selected", () => {
    const prompt = new PermissionPrompt(testTheme, createPermissionCheck(), process.cwd());
    const onDone = vi.fn();
    prompt.onDone = onDone;

    prompt.handleInput(testKey.down);
    prompt.handleInput(testKey.enter);

    expect(onDone).toHaveBeenCalledWith({ allowed: false });
  });

  it("denies when dismissed outside amendment", () => {
    const prompt = new PermissionPrompt(testTheme, createPermissionCheck(), process.cwd());
    const onDone = vi.fn();
    prompt.onDone = onDone;

    prompt.handleInput(testKey.escape);

    expect(onDone).toHaveBeenCalledWith({ allowed: false });
  });

  it("adds a trimmed amendment to one-shot decisions", () => {
    const prompt = new PermissionPrompt(testTheme, createPermissionCheck(), process.cwd());
    const onDone = vi.fn();
    prompt.onDone = onDone;

    prompt.handleInput(testKey.tab);
    prompt.handleInput("  use a narrower path  ");
    prompt.handleInput(testKey.enter);

    expect(onDone).toHaveBeenCalledWith({
      allowed: true,
      amended: "use a narrower path",
    });
  });

  it("cancels amendment before dismissing the prompt", () => {
    const prompt = new PermissionPrompt(testTheme, createPermissionCheck(), process.cwd());
    const onDone = vi.fn();
    prompt.onDone = onDone;

    prompt.handleInput(testKey.tab);
    prompt.handleInput("amendment");
    prompt.handleInput(testKey.escape);
    expect(onDone).not.toHaveBeenCalled();

    prompt.handleInput(testKey.escape);
    expect(onDone).toHaveBeenCalledWith({ allowed: false });
  });

  it("limits uncertain checks to one-shot decisions", () => {
    const prompt = new PermissionPrompt(
      testTheme,
      createPermissionCheck({
        toolName: "bash",
        category: "bash",
        extracted: ["$COMMAND arg"],
        uncertainty: "Dynamic or invalid bash command",
      }),
      process.cwd(),
    );
    const onDone = vi.fn();
    prompt.onDone = onDone;

    const rendered = prompt.render(100).join("\n");
    expect(rendered).toContain("Dynamic or invalid bash command detected");
    expect(rendered).not.toContain("allow bash tool call");

    prompt.handleInput(testKey.down);
    prompt.handleInput(testKey.down);
    prompt.handleInput(testKey.enter);
    expect(onDone).toHaveBeenCalledWith({ allowed: false });
  });

  it("cycles persistent scope labels", () => {
    const prompt = new PermissionPrompt(testTheme, createPermissionCheck(), process.cwd());

    expect(prompt.render(100).join("\n")).toContain("[this session]");
    prompt.handleInput(testKey.shiftTab);
    expect(prompt.render(100).join("\n")).toContain("[this project]");
    prompt.handleInput(testKey.shiftTab);
    expect(prompt.render(100).join("\n")).toContain("[always]");
  });

  it("shows validation feedback for malformed persistent patterns", () => {
    const prompt = new PermissionPrompt(
      testTheme,
      createPermissionCheck({ extracted: [] }),
      process.cwd(),
    );
    const onDone = vi.fn();
    prompt.onDone = onDone;

    prompt.handleInput(testKey.down);
    prompt.handleInput(testKey.down);
    prompt.handleInput(testKey.tab);
    prompt.handleInput("not-json");
    prompt.handleInput(testKey.enter);

    expect(onDone).not.toHaveBeenCalled();
    expect(prompt.render(100).join("\n")).toContain(
      "Enter non-empty patterns in double quotes, separated by commas",
    );
  });

  it("displays raw input instead of joined extracted commands", () => {
    const prompt = new PermissionPrompt(
      testTheme,
      createPermissionCheck({
        toolName: "bash",
        category: "bash",
        raw: "git status && git diff > changes.patch",
        extracted: ["git status", "git diff"],
        purpose: "Review changes",
      }),
      process.cwd(),
    );

    const rendered = prompt.render(140).join("\n");
    expect(rendered).toContain("git status && git diff > changes.patch");
    expect(rendered).not.toContain("git status, git diff");
  });

  it("normalizes and truncates displayed resources", () => {
    const longResource = `${"a".repeat(100)}b`;
    const prompt = new PermissionPrompt(
      testTheme,
      createPermissionCheck({ raw: `${longResource}\r\nsecond` }),
      process.cwd(),
    );

    const rendered = prompt.render(140).join("\n");
    expect(rendered).toContain(`${"a".repeat(100)}…`);
    expect(rendered).not.toContain(`${"a".repeat(100)}b`);
  });
});
