import { CURSOR_MARKER, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { expect, it, vi } from "vitest";
import { SecretInput } from "../../../src/web-tools/web-login/input.js";

it.each([12, 80])("conceals entered text at width %s without changing submitted value", width => {
  const input = new SecretInput();
  const secret = "fake-sensitive-token";
  const submit = vi.fn();
  input.onSubmit = submit;
  input.focused = true;
  input.handleInput(secret);

  const lines = input.render(width);

  expect(lines.join("\n")).not.toContain(secret);
  expect(lines.join("\n")).toContain(CURSOR_MARKER);
  expect(stripTerminalSequences(lines.join("\n"))).toContain("*");
  expect(lines.every(line => visibleWidth(line) <= width)).toBe(true);
  expect(input.getValue()).toBe(secret);
  input.handleInput("\r");
  expect(submit).toHaveBeenCalledWith(secret);
});

it("preserves cursor editing across masked renders", () => {
  const input = new SecretInput();
  input.handleInput("fake-12");
  input.handleInput("\x1b[D");
  input.render(20);
  input.handleInput("\x7f");
  input.handleInput("X");
  expect(input.getValue()).toBe("fake-X2");
  expect(stripTerminalSequences(input.render(20).join("\n"))).not.toMatch(/[a-zA-Z0-9]/);
});

it("pastes a key and cancels without submitting it", () => {
  const input = new SecretInput();
  const submit = vi.fn();
  const cancel = vi.fn();
  input.onSubmit = submit;
  input.onEscape = cancel;
  input.handleInput("\x1b[200~fake-pasted-key\x1b[201~");
  expect(input.getValue()).toBe("fake-pasted-key");
  expect(input.render(80).join("\n")).not.toContain("fake-pasted-key");
  input.handleInput("\x1b");
  expect(cancel).toHaveBeenCalledOnce();
  expect(submit).not.toHaveBeenCalled();
});

it("conceals Unicode input and retains its original value", () => {
  const input = new SecretInput();
  input.handleInput("fake-秘密-🔑");
  expect(stripTerminalSequences(input.render(40).join("\n"))).not.toContain("秘密");
  expect(input.getValue()).toBe("fake-秘密-🔑");
});
