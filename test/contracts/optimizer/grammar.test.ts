import { execFileSync } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createEventBus, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import grammarExtension from "../../../src/optimizer/grammar/index.js";
import { createState } from "../../../src/state.js";
import { recordExtension } from "../../helpers/extension.js";
import { createWorkspace } from "../../helpers/workspace.js";

describe("grammar startup", () => {
  it("initializes grammars and requests installation through background session dialogs", async () => {
    const workspace = await createWorkspace({ prefix: "surgent-grammar-startup-" });
    await mkdir(join(workspace.home, ".pi", "agent", "grammars"));
    execFileSync("git", ["init", "-q"], { cwd: workspace.cwd });
    await writeFile(
      join(workspace.cwd, ".pi", "settings.json"),
      JSON.stringify({ languages: ["typescript"] }),
    );
    const extension = recordExtension({ events: createEventBus() });
    const state = createState(
      extension.api,
      { name: "worker", body: "", filePath: "worker.md", meta: { description: "Test agent" } },
      "assistant",
      "parent-session",
    );
    onTestFinished(() => state.dispose());
    grammarExtension(extension.api);
    const ui = {
      notify: vi.fn(),
      setWidget: vi.fn(),
      confirm: vi.fn(async () => false),
    };
    const context = { cwd: workspace.cwd, mode: "print", hasUI: true, ui } as unknown as ExtensionContext;

    await extension.event("session_start")({ type: "session_start", reason: "startup" }, context);

    expect(ui.confirm).toHaveBeenCalledExactlyOnceWith(
      "Install tree-sitter grammars for this repo?",
      expect.stringContaining("surgent installs grammars"),
    );
    await expect(access(join(workspace.home, ".pi", "agent", "grammars", "package.json")))
      .resolves.toBeUndefined();
  });
});
