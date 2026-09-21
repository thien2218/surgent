import * as fsPromises from "node:fs/promises";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handlePermissionsCommand } from "../../../src/permission/command.js";
import {
  getRulesForDisplay,
  readRules,
  writeRules,
} from "../../../src/permission/storage.js";
import { getPiPath } from "../../../src/utils.js";
import { createPermissionSandbox } from "../../helpers/permission.js";
import { testKey, testKeybindings, testTheme, testTui } from "../../helpers/tui.js";

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return { ...actual, rename: vi.fn(actual.rename) };
});

interface DrivenComponent {
  render(width: number): string[];
  handleInput(data: string): void;
  onSave?: (data: unknown) => Promise<void> | void;
}

let sandbox: Awaited<ReturnType<typeof createPermissionSandbox>>;

beforeEach(async () => {
  sandbox = await createPermissionSandbox();
});

afterEach(async () => {
  await sandbox.cleanup();
});

function createCommandHarness(
  scripts: Array<(component: DrivenComponent) => Promise<void> | void>,
  selections: Array<string | undefined> = [],
) {
  const notifications: Array<[string, string]> = [];
  let notifyDone: (() => void) | undefined;
  const notified = new Promise<void>((resolve) => {
    notifyDone = resolve;
  });
  const custom = vi.fn(async (factory: (...args: unknown[]) => DrivenComponent) =>
    new Promise<unknown>((resolve, reject) => {
      const component = factory(testTui, testTheme, testKeybindings, resolve);
      const script = scripts.shift();
      if (!script) {
        reject(new Error("Missing custom UI script"));
        return;
      }
      void Promise.resolve(script(component)).catch(reject);
    }),
  );
  const ctx = {
    cwd: sandbox.cwd,
    hasUI: true,
    sessionManager: { getSessionId: () => "session-1" },
    ui: {
      custom,
      select: vi.fn(async () => selections.shift()),
      notify: (message: string, level: string) => {
        notifications.push([message, level]);
        notifyDone?.();
      },
      theme: testTheme,
    },
  } as unknown as ExtensionCommandContext;
  return { ctx, custom, notifications, notified };
}

describe("permissions command", () => {
  it("lists persisted rules and exits without writing", async () => {
    await writeRules({ project: { file: { "src/**": "read" } } }, sandbox.cwd);
    const original = await fsPromises.readFile(getPiPath("permissions", sandbox.cwd), "utf8");
    let rendered = "";
    const harness = createCommandHarness([
      (component) => {
        rendered = component.render(100).join("\n");
        component.handleInput(testKey.escape);
      },
    ]);

    await handlePermissionsCommand(harness.ctx);

    expect(rendered).toContain("src/**");
    expect(await fsPromises.readFile(getPiPath("permissions", sandbox.cwd), "utf8")).toBe(original);
  });

  it("adds a rule and reloads the list", async () => {
    let reloaded = "";
    const harness = createCommandHarness(
      [
        (component) => component.handleInput(testKey.enter),
        (component) => {
          component.handleInput("src/**");
          component.handleInput(testKey.enter);
        },
        (component) => {
          reloaded = component.render(100).join("\n");
          component.handleInput(testKey.escape);
        },
      ],
      ["File"],
    );

    await handlePermissionsCommand(harness.ctx);

    expect(await readRules(sandbox.cwd)).toEqual({
      "session-1": { file: { "src/**": "read" } },
    });
    expect(reloaded).toContain("src/**");
  });

  it("cancels category and input flows without persisting", async () => {
    const categoryCancel = createCommandHarness(
      [
        (component) => component.handleInput(testKey.enter),
        (component) => component.handleInput(testKey.escape),
      ],
      [undefined],
    );
    await handlePermissionsCommand(categoryCancel.ctx);
    expect(await readRules(sandbox.cwd)).toEqual({});

    const inputCancel = createCommandHarness(
      [
        (component) => component.handleInput(testKey.enter),
        (component) => component.handleInput(testKey.escape),
        (component) => component.handleInput(testKey.escape),
      ],
      ["File"],
    );
    await handlePermissionsCommand(inputCancel.ctx);
    expect(await readRules(sandbox.cwd)).toEqual({});
  });

  it("reports save failures and preserves existing data", async () => {
    await writeRules({ "session-1": { file: { "src/**": "read" } } }, sandbox.cwd);
    const filePath = getPiPath("permissions", sandbox.cwd);
    const original = await fsPromises.readFile(filePath, "utf8");
    const harness = createCommandHarness([
      async (component) => {
        vi.mocked(fsPromises.rename).mockRejectedValueOnce(new Error("replace failed"));
        component.handleInput(testKey.down);
        component.handleInput(testKey.ctrlD);
        component.handleInput(testKey.ctrlS);
        await harness.notified;
        component.handleInput(testKey.escape);
        component.handleInput(testKey.escape);
      },
    ]);

    await handlePermissionsCommand(harness.ctx);

    expect(harness.notifications).toContainEqual([
      "Failed to save permission rule: replace failed",
      "error",
    ]);
    expect(await fsPromises.readFile(filePath, "utf8")).toBe(original);
  });

  it("persists deletion of the final rules in every scope", async () => {
    await writeRules(
      {
        "session-1": { file: { "session/**": "read" } },
        project: { bash: { "git *": true } },
        other: { web: { "https://other.test/**": true } },
      },
      sandbox.cwd,
    );
    await writeRules({ mcp: { "github:*": true } });
    let saveDone: (() => void) | undefined;
    const saved = new Promise<void>((resolve) => {
      saveDone = resolve;
    });
    const harness = createCommandHarness([
      async (component) => {
        const save = component.onSave!;
        component.onSave = async (data) => {
          await save(data);
          saveDone?.();
        };
        for (let ruleIndex = 0; ruleIndex < 3; ruleIndex += 1) {
          component.handleInput(testKey.down);
          component.handleInput(testKey.ctrlD);
        }
        component.handleInput(testKey.ctrlS);
        await saved;
        component.handleInput(testKey.escape);
        component.handleInput(testKey.escape);
      },
    ]);

    await handlePermissionsCommand(harness.ctx);

    expect(await readRules(sandbox.cwd)).toEqual({
      "session-1": {},
      project: {},
      other: { web: { "https://other.test/**": true } },
    });
    expect(await readRules()).toEqual({});
    expect(await getRulesForDisplay(sandbox.cwd, "session-1")).toEqual({
      file: [],
      web: [],
      bash: [],
      mcp: [],
    });
  });

  it("rejects headless use without opening custom UI", async () => {
    const harness = createCommandHarness([]);
    const headless = {
      ...harness.ctx,
      hasUI: false,
    } as ExtensionCommandContext;

    await handlePermissionsCommand(headless);

    expect(harness.custom).not.toHaveBeenCalled();
    expect(harness.notifications).toContainEqual([
      "The /permissions command requires an interactive UI.",
      "error",
    ]);
  });
});
