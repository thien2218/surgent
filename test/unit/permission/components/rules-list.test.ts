import { afterEach, describe, expect, it, vi } from "vitest";
import PermissionRulesList from "../../../../src/permission/components/rules-list.js";
import type { GroupedDisplayRules } from "../../../../src/permission/types.js";
import { testKey, testKeybindings, testTheme, testTui } from "../../../helpers/tui.js";

function createGroups(overrides: Partial<GroupedDisplayRules> = {}): GroupedDisplayRules {
  return {
    file: [],
    web: [],
    bash: [],
    mcp: [],
    ...overrides,
  };
}

function createList(groups: GroupedDisplayRules): PermissionRulesList {
  return new PermissionRulesList(testTui, testKeybindings, testTheme, groups);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("PermissionRulesList", () => {
  it("offers Add and completes it immediately when state is saved", () => {
    const list = createList(createGroups());
    const onDone = vi.fn();
    list.onDone = onDone;

    expect(list.render(100).join("\n")).toContain("[Add new permission rule]");
    list.handleInput(testKey.enter);

    expect(onDone).toHaveBeenCalledWith("add");
  });

  it("deletes the selected rule and marks state unsaved", () => {
    const list = createList(
      createGroups({
        file: [{ category: "file", pattern: "src/**", value: "read", scope: "session" }],
      }),
    );

    list.handleInput(testKey.down);
    list.handleInput(testKey.ctrlD);

    const rendered = list.render(100).join("\n");
    expect(rendered).not.toContain("src/**");
    expect(rendered).toContain("(unsaved)");
  });

  it("serializes visible rules into their storage scopes", async () => {
    const list = createList(
      createGroups({
        file: [{ category: "file", pattern: "src/**", value: "read", scope: "project" }],
        web: [{ category: "web", pattern: "https://example.com/**", value: true, scope: "always" }],
        bash: [{ category: "bash", pattern: "git *", value: false, scope: "session" }],
        mcp: [{ category: "mcp", pattern: "github:search", value: true, scope: "session" }],
      }),
    );
    const onSave = vi.fn();
    list.onSave = onSave;

    list.handleInput(testKey.down);
    list.handleInput(testKey.down);
    list.handleInput(testKey.down);
    list.handleInput(testKey.down);
    list.handleInput(testKey.ctrlD);
    list.handleInput(testKey.ctrlS);
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());

    expect(onSave).toHaveBeenCalledWith({
      session: { bash: { "git *": false } },
      project: { file: { "src/**": "read" } },
      global: { web: { "https://example.com/**": true } },
    });
    expect(list.render(100).join("\n")).not.toContain("(unsaved)");
  });

  it("reports save failures and remains unsaved", async () => {
    const list = createList(
      createGroups({
        file: [{ category: "file", pattern: "src/**", value: "read", scope: "session" }],
      }),
    );
    const saveError = new Error("save failed");
    const onSaveErr = vi.fn();
    list.onSave = () => Promise.reject(saveError);
    list.onSaveErr = onSaveErr;

    list.handleInput(testKey.down);
    list.handleInput(testKey.ctrlD);
    list.handleInput(testKey.ctrlS);

    await vi.waitFor(() => expect(onSaveErr).toHaveBeenCalledWith(saveError));
    expect(list.render(100).join("\n")).toContain("(unsaved)");
  });

  it("saves unsaved state before opening Add", async () => {
    const list = createList(
      createGroups({
        file: [{ category: "file", pattern: "src/**", value: "read", scope: "session" }],
      }),
    );
    let resolveSave: (() => void) | undefined;
    const pendingSave = new Promise<void>((resolvePromise) => {
      resolveSave = resolvePromise;
    });
    const onDone = vi.fn();
    list.onSave = () => pendingSave;
    list.onDone = onDone;

    list.handleInput(testKey.down);
    list.handleInput(testKey.ctrlD);
    list.handleInput(testKey.enter);
    expect(onDone).not.toHaveBeenCalled();

    resolveSave?.();
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith("add"));
  });

  it("requires two dismissals while unsaved", () => {
    vi.useFakeTimers();
    const list = createList(
      createGroups({
        file: [{ category: "file", pattern: "src/**", value: "read", scope: "session" }],
      }),
    );
    const onDone = vi.fn();
    list.onDone = onDone;

    list.handleInput(testKey.down);
    list.handleInput(testKey.ctrlD);
    list.handleInput(testKey.escape);
    expect(onDone).not.toHaveBeenCalled();
    expect(list.render(100).join("\n")).toContain("again to exit without saving");

    vi.advanceTimersByTime(999);
    list.handleInput(testKey.escape);
    expect(onDone).toHaveBeenCalledWith("exit");
  });

  it("expires the first unsaved dismissal", () => {
    vi.useFakeTimers();
    const list = createList(
      createGroups({
        file: [{ category: "file", pattern: "src/**", value: "read", scope: "session" }],
      }),
    );
    const onDone = vi.fn();
    list.onDone = onDone;

    list.handleInput(testKey.down);
    list.handleInput(testKey.ctrlD);
    list.handleInput(testKey.escape);
    vi.advanceTimersByTime(1000);
    list.handleInput(testKey.escape);

    expect(onDone).not.toHaveBeenCalled();
  });

  it("cancels edits without changing the rendered rule", () => {
    const list = createList(
      createGroups({
        file: [{ category: "file", pattern: "src/**", value: "read", scope: "session" }],
      }),
    );

    list.handleInput(testKey.down);
    list.handleInput(testKey.enter);
    list.handleInput("changed");
    list.handleInput(testKey.escape);

    expect(list.render(100).join("\n")).toContain("src/**");
    expect(list.render(100).join("\n")).not.toContain("changed");
  });
});
