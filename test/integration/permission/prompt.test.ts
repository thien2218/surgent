import { join } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import PermissionPrompt from "../../../src/permission/components/prompt.js";
import type { PromptDecision } from "../../../src/permission/types.js";
import { readRules } from "../../../src/permission/storage.js";
import { makePermissionWorkspace, type PermissionWorkspace } from "../../helpers/permission.js";

let workspace: PermissionWorkspace;
beforeEach(async () => { workspace = await makePermissionWorkspace(); });
afterEach(async () => { await workspace.restore(); });

describe("permission prompt decisions", () => {
  it.each([
    { scope: "session", shifts: 0, allowed: true },
    { scope: "project", shifts: 1, allowed: true },
    { scope: "global", shifts: 2, allowed: true },
    { scope: "session", shifts: 0, allowed: false },
    { scope: "project", shifts: 1, allowed: false },
    { scope: "global", shifts: 2, allowed: false },
  ])("remembers allowed=$allowed in selected $scope scope", async ({ scope, shifts, allowed }) => {
    const component = new PermissionPrompt(
      { fg: (_color: string, text: string) => text, bold: (text: string) => text } as Theme,
      { sessionId: "session-1", toolName: "write", category: "file", raw: "config.ts", operation: "write", relative: "config.ts", absolute: join(workspace.cwd, "config.ts"), purpose: "test" },
      workspace.cwd,
    );
    const done = new Promise<PromptDecision | undefined>((resolve) => { component.onDone = resolve; });

    for (let index = 0; index < shifts; index += 1) component.handleInput("\u001b[Z");
    component.handleInput("\u001b[B");
    component.handleInput("\u001b[B");
    if (!allowed) component.handleInput("\u001b[B");
    component.handleInput("\r");

    await expect(done).resolves.toEqual({ allowed });
    const rules = { file: { "*.ts": allowed ? "write" : "deny" } };
    await expect(readRules()).resolves.toEqual(scope === "global" ? rules : {});
    await expect(readRules(workspace.cwd)).resolves.toEqual(scope === "global" ? {} : {
      [scope === "session" ? "session-1" : "project"]: rules,
    });
  });

  it.each([true, false])("emits a one-time decision without persisting rules: %s", async (allowed) => {
    const component = new PermissionPrompt(
      { fg: (_color: string, text: string) => text, bold: (text: string) => text } as Theme,
      { sessionId: "session-1", toolName: "read", category: "file", raw: "file.ts", operation: "read", relative: "file.ts", absolute: join(workspace.cwd, "file.ts"), purpose: "test" },
      workspace.cwd,
    );
    const done = new Promise<PromptDecision | undefined>((resolve) => { component.onDone = resolve; });

    if (!allowed) component.handleInput("\u001b[B");
    component.handleInput("\r");

    await expect(done).resolves.toEqual({ allowed });
    await expect(readRules()).resolves.toEqual({});
    await expect(readRules(workspace.cwd)).resolves.toEqual({});
  });
});
