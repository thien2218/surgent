import { writeFile } from "node:fs/promises";
import { join, parse } from "node:path";
import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it } from "vitest";
import permissionExtension from "../../../src/permission/index.js";
import { writeRules } from "../../../src/permission/storage.js";
import type { AgentMeta, AgentMode } from "../../../src/agent/types.js";
import { makePermissionContext, makePermissionSession } from "../../helpers/permission.js";
import { createWorkspace, type Workspace } from "../../helpers/workspace.js";

let workspace: Workspace;

beforeEach(async () => {
  workspace = await createWorkspace({ prefix: "surgent-patch-permission-", changeCwd: true });
});

const patch = (...lines: string[]) => ["*** Begin Patch", ...lines, "*** End Patch"].join("\n");
const addFiles = (...paths: string[]) => patch(...paths.flatMap((path) => [`*** Add File: ${path}`, "+x"]));
const denied = (path: string) => ({ block: true, reason: `Access to this resource is denied by policy rule: ${path}` });

function setup(
  { meta = { description: "test" }, mode = "assistant", hasUI = false }:
  { meta?: AgentMeta; mode?: AgentMode; hasUI?: boolean } = {},
) {
  const pi = makePermissionSession(meta, mode);
  const ctx = makePermissionContext(workspace.cwd, hasUI);
  permissionExtension(pi.api);
  const call = (patchText: string) => pi.event("tool_call")({
    type: "tool_call", toolCallId: "patch", toolName: "apply_patch", input: { patchText },
  } as ToolCallEvent, ctx);
  return { ctx, call };
}

describe("apply_patch permission checks", () => {
  it.each([0, 1, 2])("blocks the whole patch when section %s writes a denied path", async (position) => {
    await writeRules({ project: { file: { "secret.txt": "deny" } } }, workspace.cwd);
    const paths = ["a.txt", "b.txt", "c.txt"];
    paths[position] = "secret.txt";

    expect(await setup().call(addFiles(...paths))).toEqual(denied("secret.txt"));
  });

  it.each([
    { side: "source", path: "from.txt" },
    { side: "destination", path: "to.txt" },
  ])("checks the $side of a move", async ({ path }) => {
    await writeFile(join(workspace.cwd, "from.txt"), "x\n");
    await writeRules({ project: { file: { [path]: "deny" } } }, workspace.cwd);

    const result = await setup().call(patch("*** Update File: from.txt", "*** Move to: to.txt", "@@", "-x", "+y"));

    expect(result).toEqual(denied(path));
  });

  it("keeps checking later paths after an approved prompt", async () => {
    await writeRules({ project: { file: { "b.txt": "deny" } } }, workspace.cwd);
    const { ctx, call } = setup({ mode: "restricted", hasUI: true });
    ctx.ui.custom.mockResolvedValue({ allowed: true });

    expect(await call(addFiles("a.txt", "b.txt"))).toEqual(denied("b.txt"));
    expect(ctx.ui.custom).toHaveBeenCalledOnce();
  });

  it("asks for each path and allows the patch when every prompt is approved", async () => {
    const { ctx, call } = setup({ mode: "restricted", hasUI: true });
    ctx.ui.custom.mockResolvedValue({ allowed: true });

    expect(await call(addFiles("a.txt", "b.txt"))).toBeUndefined();
    expect(ctx.ui.custom).toHaveBeenCalledTimes(2);
  });

  it("stops at the first rejected prompt", async () => {
    const { ctx, call } = setup({ mode: "restricted", hasUI: true });
    ctx.ui.custom.mockResolvedValue({ allowed: false });

    expect(await call(addFiles("a.txt", "b.txt"))).toMatchObject({ block: true, reason: expect.stringContaining("User rejected") });
    expect(ctx.ui.custom).toHaveBeenCalledOnce();
  });

  it("blocks a patch that writes a .piignore path", async () => {
    await writeFile(join(workspace.cwd, ".piignore"), "private/\n");

    expect(await setup().call(addFiles("notes.txt", "private/key.txt")))
      .toEqual({ block: true, reason: 'Path blocked by .piignore rule "private/"' });
  });

  it("applies the agent's write scope to every path", async () => {
    const { call } = setup({ meta: { description: "test", "files.write": ["src/**"] } });

    expect(await call(addFiles("src/a.ts", "docs/b.md")))
      .toEqual({ block: true, reason: "Access to this resource is beyond allowed scope" });
    expect(await call(addFiles("src/a.ts", "src/b.ts"))).toBeUndefined();
  });

  it("checks heredoc-wrapped and CRLF patches the way the tool parses them", async () => {
    await writeRules({ project: { file: { "secret.txt": "deny" } } }, workspace.cwd);
    const { call } = setup();

    expect(await call(`cat <<'EOF'\n${addFiles("secret.txt")}\nEOF`)).toEqual(denied("secret.txt"));
    expect(await call(addFiles("secret.txt").replaceAll("\n", "\r\n"))).toEqual(denied("secret.txt"));
  });

  it("asks before writing outside the allowed roots", async () => {
    const { call } = setup();
    // The temp directory is an allowed root, so use the filesystem root.
    const outside = join(parse(workspace.root).root, "surgent-outside.txt");

    expect(await call(addFiles("inside.txt"))).toBeUndefined();
    expect(await call(addFiles("inside.txt", outside)))
      .toEqual({ block: true, reason: "Permission request requires interactive UI" });
  });

  it.each([["unparseable text", "not a patch"], ["an empty envelope", patch()]])(
    "passes %s to the tool without prompting, since the tool writes nothing", async (_case, patchText) => {
      const { ctx, call } = setup({ mode: "restricted", hasUI: true });

      expect(await call(patchText)).toBeUndefined();
      expect(ctx.ui.custom).not.toHaveBeenCalled();
    },
  );
});
