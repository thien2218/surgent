import type { Theme } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, stripTerminalSequences, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { expect, it, vi } from "vitest";
import { SecretInput } from "../../../src/web-tools/web-login/input.js";

function createInput() {
  return new SecretInput(
    { requestRender() {} } as unknown as TUI,
    { fg: (_color: string, text: string) => text } as Theme,
    "API key",
    "Paste API key",
  );
}

it.each([12, 80])("conceals entered text at width %s without changing submitted value", width => {
  const input = createInput();
  const secret = "fake-sensitive-token";
  const submit = vi.fn();
  input.onDone = submit;
  input.focused = true;
  input.handleInput(secret);

  const lines = input.render(width);

  expect(lines.join("\n")).not.toContain(secret);
  expect(lines.join("\n")).toContain(CURSOR_MARKER);
  expect(stripTerminalSequences(lines.join("\n"))).toContain("*");
  expect(lines.every(line => visibleWidth(line) <= width)).toBe(true);
  input.handleInput("\r");
  expect(submit).toHaveBeenCalledWith(secret);
});

it("preserves cursor editing across masked renders", () => {
  const input = createInput();
  input.handleInput("fake-12");
  input.handleInput("\x1b[D");
  input.render(20);
  input.handleInput("\x7f");
  input.handleInput("X");
  expect(stripTerminalSequences(input.render(20).join("\n"))).not.toContain("fake-X2");
  const submit = vi.fn();
  input.onDone = submit;
  input.handleInput("\r");
  expect(submit).toHaveBeenCalledWith("fake-X2");
});

it("pastes a key and cancels without submitting it", () => {
  const input = createInput();
  const cancel = vi.fn();
  input.onDone = cancel;
  input.handleInput("\x1b[200~fake-pasted-key\x1b[201~");
  expect(input.render(80).join("\n")).not.toContain("fake-pasted-key");
  input.handleInput("\x1b");
  expect(cancel).toHaveBeenCalledExactlyOnceWith(undefined);
});

it("conceals Unicode input and retains its original value", () => {
  const input = createInput();
  input.handleInput("fake-秘密-🔑");
  expect(stripTerminalSequences(input.render(40).join("\n"))).not.toContain("秘密");
  const submit = vi.fn();
  input.onDone = submit;
  input.handleInput("\r");
  expect(submit).toHaveBeenCalledWith("fake-秘密-🔑");
});

it("submits a bracketed paste unchanged through the frame binding", () => {
  const input = createInput();
  const submit = vi.fn();
  input.onDone = submit;
  input.handleInput("\x1b[200~fake-pasted-key\x1b[201~");
  input.render(40);
  input.handleInput("\r");
  expect(submit).toHaveBeenCalledExactlyOnceWith("fake-pasted-key");
});
