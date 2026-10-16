import { readFileSync } from "node:fs";
import { CustomEditor, VERSION as PI_VERSION } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Key, KeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    setTitle: vi.fn<ExtensionContext["ui"]["setTitle"]>(),
    theme: theme as Theme,
  } satisfies Pick<ExtensionContext["ui"], "setHeader" | "setEditorComponent" | "setTitle" | "theme">;
  const sessionManager = {
    getCwd: vi.fn<ExtensionContext["sessionManager"]["getCwd"]>().mockReturnValue("/workspace/project"),
    getSessionName: vi.fn<ExtensionContext["sessionManager"]["getSessionName"]>(),
  } satisfies Pick<ExtensionContext["sessionManager"], "getCwd" | "getSessionName">;
  const context = { hasUI: true, mode: "tui", ui, sessionManager } as unknown as ExtensionContext;
  const tui = { requestRender: vi.fn(), terminal: { rows: 40, columns: 100 } } as unknown as TUI;
  const start = () => extension.event("session_start")({ type: "session_start", reason: "startup" }, context);
  const cycle = () => extension.shortcut(Key.ctrlAlt("b")).handler(context);

  function createEditor(keybindings = new KeybindingsManager(TUI_KEYBINDINGS)) {
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
    const editor = factory(
      tui,
      editorTheme,
      keybindings as import("@earendil-works/pi-coding-agent").KeybindingsManager,
    );
    if (!(editor instanceof CustomEditor)) throw new Error("UI factory did not create a CustomEditor");
    return editor;
  }

  return { extension, ui, context, sessionManager, tui, start, cycle, createEditor };
}

describe("UI extension contract", () => {
  describe("terminal title", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
      vi.clearAllTimers();
      vi.useRealTimers();
    });

    it("sets idle title at startup and cycles frames every 50 ms", async () => {
      const { extension, ui, context, start } = setup();
      await start();
      expect(ui.setTitle).toHaveBeenCalledExactlyOnceWith("π   project");

      await extension.event("agent_start")({ type: "agent_start" }, context);
      vi.advanceTimersByTime(49);
      expect(ui.setTitle).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(1);
      expect(ui.setTitle).toHaveBeenLastCalledWith("⠋   project");
      vi.advanceTimersByTime(50);
      expect(ui.setTitle).toHaveBeenLastCalledWith("⠙   project");
      vi.advanceTimersByTime(9 * 50);
      expect(ui.setTitle).toHaveBeenCalledTimes(12);
      expect(ui.setTitle).toHaveBeenLastCalledWith("⠋   project");
    });

    it("keeps one animation without flashing idle on repeated starts", async () => {
      const { extension, ui, context } = setup();
      await extension.event("agent_start")({ type: "agent_start" }, context);
      vi.advanceTimersByTime(25);

      await extension.event("agent_start")({ type: "agent_start" }, context);
      await extension.event("agent_start")({ type: "agent_start" }, context);
      vi.advanceTimersByTime(25);
      vi.advanceTimersByTime(50);

      expect(ui.setTitle.mock.calls).toEqual([
        ["⠋   project"],
        ["⠙   project"],
      ]);
    });

    it.each([false, true])("restores idle after settlement (aborted: %s) and allows another run", async (aborted) => {
      const { extension, ui, context, sessionManager } = setup();
      await extension.event("agent_start")({ type: "agent_start" }, context);
      vi.advanceTimersByTime(100);
      sessionManager.getSessionName.mockReturnValue("finished session");
      sessionManager.getCwd.mockReturnValue("/sessions/finished-dir");

      await extension.event("agent_settled")({ type: "agent_settled", aborted }, context);
      expect(ui.setTitle.mock.calls).toEqual([
        ["⠋   project"],
        ["⠙   project"],
        ["π   finished session - finished-dir"],
      ]);
      vi.advanceTimersByTime(500);
      expect(ui.setTitle).toHaveBeenCalledTimes(3);

      await extension.event("agent_start")({ type: "agent_start" }, context);
      expect(ui.setTitle).toHaveBeenCalledTimes(3);
      vi.advanceTimersByTime(50);
      expect(ui.setTitle).toHaveBeenLastCalledWith("⠋   finished session - finished-dir");
      vi.advanceTimersByTime(50);
      expect(ui.setTitle).toHaveBeenLastCalledWith("⠙   finished session - finished-dir");
    });

    it("restores idle on shutdown once and never writes afterward", async () => {
      const { extension, ui, context } = setup();
      await extension.event("agent_start")({ type: "agent_start" }, context);

      await extension.event("session_shutdown")({ type: "session_shutdown", reason: "quit" }, context);
      await extension.event("session_shutdown")({ type: "session_shutdown", reason: "quit" }, context);
      await extension.event("agent_settled")({ type: "agent_settled", aborted: true }, context);
      vi.advanceTimersByTime(800);

      expect(ui.setTitle.mock.calls).toEqual([["π   project"]]);
    });

    it("reads current session and directory metadata on every frame", async () => {
      const { extension, ui, context, sessionManager } = setup();
      sessionManager.getSessionName.mockReturnValue("original session");
      sessionManager.getCwd.mockReturnValue("/sessions/original-dir");
      await extension.event("agent_start")({ type: "agent_start" }, context);
      vi.advanceTimersByTime(50);

      sessionManager.getSessionName.mockReturnValue("renamed session");
      sessionManager.getCwd.mockReturnValue("/sessions/new-dir");
      vi.advanceTimersByTime(50);
      sessionManager.getSessionName.mockReturnValue(undefined);
      vi.advanceTimersByTime(50);
      await extension.event("agent_settled")({ type: "agent_settled", aborted: false }, context);

      expect(ui.setTitle.mock.calls).toEqual([
        ["⠋   original session - original-dir"],
        ["⠙   renamed session - new-dir"],
        ["⠹   new-dir"],
        ["π   new-dir"],
      ]);
    });

    it("strips terminal escapes and control characters from active and idle titles", async () => {
      const { extension, ui, context, sessionManager } = setup();
      sessionManager.getSessionName.mockReturnValue("\x1b]0;hidden\x07review\x1b[31m name\x1b[0m\x00\x01\t\r\n\x7f\x85");
      sessionManager.getCwd.mockReturnValue("/sessions/\x1b[32mproject\x1b[0m\x07\n\x7f\x9f");

      await extension.event("agent_start")({ type: "agent_start" }, context);
      vi.advanceTimersByTime(100);
      await extension.event("agent_settled")({ type: "agent_settled", aborted: false }, context);

      expect(ui.setTitle.mock.calls).toEqual([
        ["⠋   review name - project"],
        ["⠙   review name - project"],
        ["π   review name - project"],
      ]);
    });

    it.each([
      { mode: "rpc", hasUI: false, titles: [] },
      { mode: "rpc", hasUI: true, titles: [["π   project"]] },
      { mode: "json", hasUI: false, titles: [] },
      { mode: "print", hasUI: false, titles: [] },
    ] as const)("keeps animation off in $mode (hasUI: $hasUI)", async ({ mode, hasUI, titles }) => {
      const { extension, ui, context } = setup();
      const headless = { ...context, mode, hasUI };

      await extension.event("session_start")({ type: "session_start", reason: "startup" }, headless);
      expect(ui.setTitle.mock.calls).toEqual(titles);
      await extension.event("agent_start")({ type: "agent_start" }, headless);
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(800);
      await extension.event("agent_settled")({ type: "agent_settled", aborted: false }, headless);
      await extension.event("session_shutdown")({ type: "session_shutdown", reason: "quit" }, headless);
      vi.advanceTimersByTime(800);

      expect(ui.setTitle.mock.calls).toEqual(titles);
    });
  });

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

  it("uses injected history and submit keys without losing bash mode across entries", async () => {
    const { start, createEditor } = setup();
    await start();
    const editor = createEditor(new KeybindingsManager(TUI_KEYBINDINGS, {
      "tui.editor.cursorUp": "f6",
      "tui.editor.cursorDown": "f7",
      "tui.input.submit": "f8",
    }));
    const submit = vi.fn();
    editor.onSubmit = submit;
    editor.addToHistory("first");
    editor.addToHistory("!second");
    editor.addToHistory("!!third");
    editor.render(80);

    for (const value of ["!!third", "!second", "first"]) {
      editor.handleInput("\x1b[17~");
      expect(editor.getText()).toBe(value);
    }
    for (const value of ["!second", "!!third", ""]) {
      editor.handleInput("\x1b[18~");
      expect(editor.getText()).toBe(value);
    }
    editor.handleInput("\x1b[17~");
    editor.handleInput("\x1b[19~");

    expect(submit).toHaveBeenCalledExactlyOnceWith("!!third");
    expect(editor.getText()).toBe("");
  });

  it("forwards unrelated injected application shortcuts to CustomEditor", async () => {
    const { start, createEditor } = setup();
    await start();
    const editor = createEditor(new KeybindingsManager({
      ...TUI_KEYBINDINGS,
      "app.interrupt": { defaultKeys: [], description: "Interrupt" },
    }, { "app.interrupt": "f9" }));
    const escape = vi.fn();
    editor.onEscape = escape;
    editor.setText("!!keep input");

    editor.handleInput("\x1b[20~");

    expect(escape).toHaveBeenCalledOnce();
    expect(editor.getText()).toBe("!!keep input");
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
