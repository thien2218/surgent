import { readFileSync } from "node:fs";
import { VERSION as PI_VERSION } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Key, KeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import uiExtension from "../../../src/ui/index.js";
import { recordExtension } from "../../helpers/extension.js";

function setup() {
  const extension = recordExtension();
  uiExtension(extension.api);

  const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } satisfies Pick<Theme, "fg" | "bold">;
  const ui = {
    setHeader: vi.fn<ExtensionContext["ui"]["setHeader"]>(),
    setEditorComponent: vi.fn<ExtensionContext["ui"]["setEditorComponent"]>(),
    theme: theme as Theme,
  } satisfies Pick<ExtensionContext["ui"], "setHeader" | "setEditorComponent" | "theme">;
  const context = { hasUI: true, ui } as unknown as ExtensionContext;
  const tui = { requestRender: vi.fn() } as unknown as TUI;
  const start = () => extension.event("session_start")({ type: "session_start", reason: "startup" }, context);
  const cycle = () => extension.shortcut(Key.ctrlAlt("b")).handler(context);

  function createEditor() {
    const factory = ui.setEditorComponent.mock.calls.at(-1)?.[0];
    if (!factory) throw new Error("UI session did not install an editor factory");
    const plain = (text: string) => text;
    const editorTheme: EditorTheme = {
      borderColor: plain,
      selectList: {
        selectedPrefix: plain,
        selectedText: plain,
        description: plain,
        scrollInfo: plain,
        noMatch: plain,
      },
    };
    return factory(
      tui,
      editorTheme,
      new KeybindingsManager(TUI_KEYBINDINGS) as import("@earendil-works/pi-coding-agent").KeybindingsManager,
    );
  }

  return { extension, ui, context, tui, start, cycle, createEditor };
}

describe("UI extension contract", () => {
  it("leaves header and editor untouched in headless sessions", async () => {
    const { extension, ui, context } = setup();

    await extension.event("session_start")(
      { type: "session_start", reason: "startup" },
      { ...context, hasUI: false },
    );

    expect(ui.setHeader).not.toHaveBeenCalled();
    expect(ui.setEditorComponent).not.toHaveBeenCalled();
  });

  it("allows the mode shortcut before Pi creates an editor", async () => {
    const { start, cycle, createEditor } = setup();

    await cycle();
    await start();
    await cycle();
    const editor = createEditor();
    editor.setText("echo hello");

    expect(editor.getText()).toBe("echo hello");
  });

  it("installs a header showing package and Pi versions", async () => {
    const { ui, tui, start } = setup();
    const packageJson = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));

    await start();
    const factory = ui.setHeader.mock.calls.at(-1)?.[0];
    if (!factory) throw new Error("UI session did not install a header factory");
    const header = factory(tui, ui.theme);

    expect(header.render(120)).toEqual([
      `${packageJson.name} v${packageJson.version} · built on top of pi v${PI_VERSION}`,
    ]);
    header.invalidate();
    expect(header.render(120)).toEqual([
      `${packageJson.name} v${packageJson.version} · built on top of pi v${PI_VERSION}`,
    ]);
  });

  it("routes Ctrl+Alt+B through prompt, included bash, and excluded bash without losing input", async () => {
    const { start, cycle, createEditor } = setup();
    await start();
    const editor = createEditor();
    editor.setText("echo hello");

    await cycle();
    expect(editor.getText()).toBe("!echo hello");
    await cycle();
    expect(editor.getText()).toBe("!!echo hello");
    await cycle();
    expect(editor.getText()).toBe("echo hello");
  });

  it("routes the shortcut to the replacement editor when Pi recreates it", async () => {
    const { start, cycle, createEditor } = setup();
    await start();
    const previous = createEditor();
    previous.setText("previous input");
    const current = createEditor();
    current.setText("current input");

    await cycle();

    expect(current.getText()).toBe("!current input");
    expect(previous.getText()).toBe("previous input");
  });
});
