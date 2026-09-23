import type { Theme } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, TUI_KEYBINDINGS, type TUI } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import PermissionRulesList from "../../../src/permission/components/rules-list.js";
import { getRulesForDisplay, readRules, writeRules } from "../../../src/permission/storage.js";
import { makePermissionWorkspace, type PermissionWorkspace } from "../../helpers/permission.js";

let workspace: PermissionWorkspace;
beforeEach(async () => { workspace = await makePermissionWorkspace(); });
afterEach(async () => { await workspace.restore(); });

describe("permission rule shortcuts", () => {
  it.each([true, false])("edits through public input and saves only committed changes: %s", async (commit) => {
    await writeRules({ "session-1": { file: { "src/file.ts": "read" } } }, workspace.cwd);
    const component = new PermissionRulesList(
      { requestRender: () => {} } as TUI,
      new KeybindingsManager(TUI_KEYBINDINGS) as import("@earendil-works/pi-coding-agent").KeybindingsManager,
      { fg: (_color: string, text: string) => text, bold: (text: string) => text } as Theme,
      workspace.cwd, "session-1", await getRulesForDisplay(workspace.cwd, "session-1"),
    );
    const done = new Promise<string>((resolve, reject) => {
      component.onDone = resolve;
      component.onSaveErr = reject;
    });

    component.handleInput("\u001b[B");
    component.handleInput("\r");
    component.handleInput(".bak");
    component.handleInput(commit ? "\r" : "\u001b");
    component.handleInput("\u001b[A");
    component.handleInput("\r");

    await expect(done).resolves.toBe("add");
    await expect(readRules(workspace.cwd)).resolves.toEqual({
      "session-1": { file: { [commit ? "src/file.ts.bak" : "src/file.ts"]: "read" } },
      ...(commit ? { project: {} } : {}),
    });
  });

  it.each([
    { key: "\t", scope: "session-1", value: "write" },
    { key: "\u001b[Z", scope: "project", value: "read" },
  ])("saves the action advertised for $key", async ({ key, scope, value }) => {
    await writeRules({ "session-1": { file: { "src/file.ts": "read" } } }, workspace.cwd);
    const component = new PermissionRulesList(
      { requestRender: () => {} } as TUI,
      new KeybindingsManager(TUI_KEYBINDINGS) as import("@earendil-works/pi-coding-agent").KeybindingsManager,
      { fg: (_color: string, text: string) => text, bold: (text: string) => text } as Theme,
      workspace.cwd, "session-1", await getRulesForDisplay(workspace.cwd, "session-1"),
    );
    const done = new Promise<string>((resolve, reject) => {
      component.onDone = resolve;
      component.onSaveErr = reject;
    });

    component.handleInput("\u001b[B");
    component.handleInput(key);
    component.handleInput("\u001b[A");
    component.handleInput("\r");

    await expect(done).resolves.toBe("add");
    await expect(readRules(workspace.cwd)).resolves.toEqual({
      "session-1": {}, project: {}, [scope]: { file: { "src/file.ts": value } },
    });
    await expect(readRules()).resolves.toEqual({});
  });
});
