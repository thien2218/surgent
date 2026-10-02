import { keyHint, type Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { customText, renderCallText, renderResultText } from "../../../src/utils.js";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...await importOriginal<typeof import("@earendil-works/pi-coding-agent")>(),
  keyHint: vi.fn(() => "[expand]"),
}));

let theme: Theme;

beforeEach(() => {
  vi.mocked(keyHint).mockClear();
  theme = { fg: vi.fn<Theme["fg"]>((_color, text) => text) } as unknown as Theme;
});

function lines(component: { render(width: number): string[] }, width = 40) {
  return component.render(width).map((line) => stripTerminalSequences(line).trimEnd());
}

describe("text components", () => {
  it("renders unpadded text by default", () => {
    expect(lines(customText("hello"))).toEqual(["hello"]);
  });

  it.each([
    { padding: { x: 2 }, expected: ["  hello"] },
    { padding: { y: 1 }, expected: ["", "hello", ""] },
    { padding: { x: 2, y: 1 }, expected: ["", "  hello", ""] },
  ])("applies only requested padding $padding", ({ padding, expected }) => {
    expect(lines(customText("hello", padding))).toEqual(expected);
  });

  it.each([true, false])("adds a separator only after a completed call: partial=%s", (partial) => {
    expect(lines(renderCallText("reading file.ts", partial)))
      .toEqual(partial ? ["reading file.ts"] : ["reading file.ts", ""]);
  });
});

describe("tool result rendering", () => {
  it("shows every line when expanded", () => {
    const text = Array.from({ length: 12 }, (_value, index) => `line ${index + 1}`).join("\n");

    expect(lines(renderResultText(text, theme, true))).toEqual(text.split("\n"));
    expect(theme.fg).toHaveBeenCalledWith("toolOutput", text);
    expect(keyHint).not.toHaveBeenCalled();
  });

  it.each([1, 10])("shows %s lines without an expand hint when nothing is hidden", (count) => {
    const text = Array.from({ length: count }, (_value, index) => `line ${index + 1}`).join("\n");
    const component = renderResultText(text, theme, false);

    expect(lines(component)).toEqual(text.split("\n"));
    component.invalidate();
    expect(lines(component)).toEqual(text.split("\n"));
    expect(keyHint).not.toHaveBeenCalled();
  });

  it("keeps the last ten collapsed lines and reports hidden lines with the expand shortcut", () => {
    const text = Array.from({ length: 12 }, (_value, index) => `line ${index + 1}`).join("\n");

    const rendered = lines(renderResultText(text, theme, false));

    expect(rendered.slice(0, 10)).toEqual(text.split("\n").slice(-10));
    expect(rendered[10]).toBe("... (2 more lines, [expand])");
    expect(rendered).toHaveLength(11);
    expect(keyHint).toHaveBeenCalledWith("app.tools.expand", "to expand");
  });

  it("counts wrapped visual lines and recalculates when width changes", () => {
    const component = renderResultText("ab".repeat(12), theme, false);

    expect(lines(component, 2)).toEqual([...Array<string>(10).fill("ab"), "... (2 more lines, [expand])"]);
    expect(lines(component, 24)).toEqual(["ab".repeat(12)]);
  });
});
