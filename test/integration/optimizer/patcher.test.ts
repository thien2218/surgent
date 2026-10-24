import { access, chmod, lstat, mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  withFileMutationQueue, type AgentToolResult, type ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { applyPatch } from "../../../src/optimizer/patcher/tool.js";
import type { PatchedFile } from "../../../src/optimizer/patcher/types.js";
import { createWorkspace } from "../../helpers/workspace.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, writeFile: vi.fn(original.writeFile) };
});

const patch = (...lines: string[]) => ["*** Begin Patch", ...lines, "*** End Patch"].join("\n");

async function setup() {
  const workspace = await createWorkspace({ prefix: "surgent-patcher-" });
  const path = (name: string) => join(workspace.cwd, name);
  return {
    ...workspace,
    path,
    run: (patchText: string, signal?: AbortSignal) =>
      applyPatch.execute(
        "call", { patchText }, signal, undefined, { cwd: workspace.cwd } as ExtensionToolContext,
      ) as Promise<AgentToolResult<{ files: PatchedFile[] }>>,
    read: (name: string) => readFile(path(name), "utf8"),
    exists: (name: string) => access(path(name)).then(() => true, () => false),
  };
}

describe("apply_patch file changes", () => {
  it("adds, updates, moves and deletes files in one call", async () => {
    const fixture = await setup();
    await writeFile(fixture.path("app.py"), 'def greet():\n    print("Hi")\n');
    await writeFile(fixture.path("old.txt"), "keep\nold\n");
    await writeFile(fixture.path("obsolete.txt"), "gone\n");

    const result = await fixture.run(patch(
      "*** Add File: docs/new/hello.txt", "+Hello", "+world",
      "*** Update File: app.py", "@@ def greet():", '-    print("Hi")', '+    print("Hello")',
      "*** Update File: old.txt", "*** Move to: moved/renamed.txt", "@@", " keep", "-old", "+new",
      "*** Delete File: obsolete.txt",
    ));

    expect(result.content).toEqual([{
      type: "text",
      text: "Success. Updated the following files:\nA docs/new/hello.txt\nM app.py\nM moved/renamed.txt\nD obsolete.txt",
    }]);
    expect(result.details.files).toMatchObject([
      { type: "add", path: "docs/new/hello.txt" }, { type: "update", path: "app.py" },
      { type: "move", path: "moved/renamed.txt" }, { type: "delete", path: "obsolete.txt" },
    ]);
    expect(result.details.files[1]?.diff).toContain('print("Hello")');
    expect(await fixture.read("docs/new/hello.txt")).toBe("Hello\nworld\n");
    expect(await fixture.read("app.py")).toBe('def greet():\n    print("Hello")\n');
    expect(await fixture.read("moved/renamed.txt")).toBe("keep\nnew\n");
    expect(await fixture.exists("old.txt")).toBe(false);
    expect(await fixture.exists("obsolete.txt")).toBe(false);
  });

  it("preserves a byte order mark on update and move", async () => {
    const fixture = await setup();
    await writeFile(fixture.path("a.txt"), "﻿one\n");
    await writeFile(fixture.path("b.txt"), "﻿two\n");

    await fixture.run(patch(
      "*** Update File: a.txt", "@@", "-one", "+ONE",
      "*** Update File: b.txt", "*** Move to: c.txt", "@@", "-two", "+TWO",
    ));

    expect(await fixture.read("a.txt")).toBe("﻿ONE\n");
    expect(await fixture.read("c.txt")).toBe("﻿TWO\n");
  });

  it("keeps a CRLF file's line endings for every line it rewrites", async () => {
    const fixture = await setup();
    await writeFile(fixture.path("a.txt"), "one\r\ntwo\r\nthree\r\n");

    const result = await fixture.run(patch("*** Update File: a.txt", "@@", " one", "-two", "+TWO"));

    expect(await fixture.read("a.txt")).toBe("one\r\nTWO\r\nthree\r\n");
    expect(result.details.files[0]?.diff).not.toContain("\r");
  });

  it("writes no carriage returns from a CRLF patch", async () => {
    const fixture = await setup();
    await writeFile(fixture.path("a.txt"), "one\ntwo\n");

    await fixture.run(patch(
      "*** Update File: a.txt", "@@", "-one", "+ONE", "*** Add File: b.txt", "+new",
    ).replaceAll("\n", "\r\n"));

    expect(await fixture.read("a.txt")).toBe("ONE\ntwo\n");
    expect(await fixture.read("b.txt")).toBe("new\n");
  });

  it("anchors an *** End of File chunk to the last occurrence", async () => {
    const fixture = await setup();
    await writeFile(fixture.path("a.txt"), "x\ny\nx\n");

    await fixture.run(patch("*** Update File: a.txt", "@@", "-x", "+X", "*** End of File"));

    expect(await fixture.read("a.txt")).toBe("x\ny\nX\n");
  });

  it("resolves relative and absolute paths against the working directory", async () => {
    const fixture = await setup();

    const result = await fixture.run(patch(
      "*** Add File: ../outside.txt", "+relative", `*** Add File: ${join(fixture.root, "absolute.txt")}`, "+absolute",
    ));

    expect(await readFile(join(fixture.root, "outside.txt"), "utf8")).toBe("relative\n");
    expect(await readFile(join(fixture.root, "absolute.txt"), "utf8")).toBe("absolute\n");
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("A ../outside.txt\nA ../absolute.txt") });
  });

  it("replaces an existing file named by Add File", async () => {
    const fixture = await setup();
    await writeFile(fixture.path("a.txt"), "old\n");

    await fixture.run(patch("*** Add File: a.txt", "+new"));

    expect(await fixture.read("a.txt")).toBe("new\n");
  });
});

describe("apply_patch verification", () => {
  it.each([
    ["missing context", ["*** Update File: a.txt", "@@ nowhere", "-one", "+two"], "Failed to find context 'nowhere'"],
    ["missing lines", ["*** Update File: a.txt", "@@", "-nope", "+two"], "Failed to find expected lines"],
    ["a missing file to update", ["*** Update File: missing.txt", "@@", "-x", "+y"], "Failed to read file to update"],
    ["a missing file to delete", ["*** Delete File: missing.txt"], "Failed to read file to delete"],
    ["a directory", ["*** Update File: dir", "@@", "-x", "+y"], "Not a regular file"],
  ])("changes nothing when a later section has %s", async (_case, failing, message) => {
    const fixture = await setup();
    await writeFile(fixture.path("a.txt"), "one\n");
    await writeFile(fixture.path("b.txt"), "keep\n");
    await mkdir(fixture.path("dir"));

    await expect(fixture.run(patch(
      "*** Update File: b.txt", "@@", "-keep", "+changed", "*** Add File: new.txt", "+x", ...failing,
    ))).rejects.toThrow(message);

    expect(await fixture.read("b.txt")).toBe("keep\n");
    expect(await fixture.exists("new.txt")).toBe(false);
  });

  it("changes nothing when the call is aborted", async () => {
    const fixture = await setup();
    await writeFile(fixture.path("b.txt"), "keep\n");
    const controller = new AbortController();
    controller.abort();

    await expect(fixture.run(patch(
      "*** Update File: b.txt", "@@", "-keep", "+changed", "*** Add File: new.txt", "+x",
    ), controller.signal)).rejects.toThrow();

    expect(await fixture.read("b.txt")).toBe("keep\n");
    expect(await fixture.exists("new.txt")).toBe(false);
  });
});

describe("apply_patch sections on one file", () => {
  it("applies two updates to the same file in order", async () => {
    const fixture = await setup();
    await writeFile(fixture.path("a.txt"), "one\ntwo\n");

    const result = await fixture.run(patch(
      "*** Update File: a.txt", "@@", "-one", "+ONE", "*** Update File: a.txt", "@@", "-two", "+TWO",
    ));

    expect(await fixture.read("a.txt")).toBe("ONE\nTWO\n");
    expect(result.content[0]).toMatchObject({ text: "Success. Updated the following files:\nM a.txt\nM a.txt" });
  });

  it("updates a file added earlier in the patch", async () => {
    const fixture = await setup();

    await fixture.run(patch("*** Add File: a.txt", "+one", "*** Update File: a.txt", "@@", "-one", "+two"));

    expect(await fixture.read("a.txt")).toBe("two\n");
  });

  it("replaces a file deleted earlier in the patch", async () => {
    const fixture = await setup();
    await writeFile(fixture.path("a.txt"), "old\n");

    await fixture.run(patch("*** Delete File: a.txt", "*** Add File: a.txt", "+new"));

    expect(await fixture.read("a.txt")).toBe("new\n");
  });

  it("leaves nothing for a file added and deleted in the same patch", async () => {
    const fixture = await setup();

    await fixture.run(patch("*** Add File: a.txt", "+tmp", "*** Delete File: a.txt"));

    expect(await fixture.exists("a.txt")).toBe(false);
  });

  it("rejects updating a file deleted earlier in the patch", async () => {
    const fixture = await setup();
    await writeFile(fixture.path("a.txt"), "one\n");

    await expect(fixture.run(patch("*** Delete File: a.txt", "*** Update File: a.txt", "@@", "-one", "+two")))
      .rejects.toThrow("Failed to read file to update");

    expect(await fixture.read("a.txt")).toBe("one\n");
  });
});

describe("apply_patch moves", () => {
  it.each(["a.txt", "./a.txt"])("keeps a file moved onto itself as %s", async (destination) => {
    const fixture = await setup();
    await writeFile(fixture.path("a.txt"), "one\n");

    const result = await fixture.run(patch("*** Update File: a.txt", `*** Move to: ${destination}`, "@@", "-one", "+two"));

    expect(await fixture.read("a.txt")).toBe("two\n");
    expect(result.content[0]).toMatchObject({ text: "Success. Updated the following files:\nM a.txt" });
  });

  it("replaces the destination and removes the source", async () => {
    const fixture = await setup();
    await writeFile(fixture.path("a.txt"), "one\n");
    await writeFile(fixture.path("b.txt"), "existing\n");

    await fixture.run(patch("*** Update File: a.txt", "*** Move to: b.txt", "@@", "-one", "+two"));

    expect(await fixture.read("b.txt")).toBe("two\n");
    expect(await fixture.exists("a.txt")).toBe(false);
  });
});

describe("apply_patch symlinks", () => {
  it("rejects a patch naming a file and its symlink without writing either", async () => {
    const fixture = await setup();
    await writeFile(fixture.path("real.txt"), "one\n");
    await symlink(fixture.path("real.txt"), fixture.path("link.txt"));

    await expect(fixture.run(patch(
      "*** Update File: link.txt", "@@", "-one", "+two", "*** Update File: real.txt", "@@", "-one", "+three",
    ))).rejects.toThrow(`${fixture.path("link.txt")} and ${fixture.path("real.txt")} are the same file`);

    expect(await fixture.read("real.txt")).toBe("one\n");
  });

  it("updates the target through a symlink and keeps the link", async () => {
    const fixture = await setup();
    await writeFile(fixture.path("real.txt"), "one\n");
    await symlink(fixture.path("real.txt"), fixture.path("link.txt"));

    await fixture.run(patch("*** Update File: link.txt", "@@", "-one", "+two"));

    expect(await fixture.read("real.txt")).toBe("two\n");
    expect((await lstat(fixture.path("link.txt"))).isSymbolicLink()).toBe(true);
  });
});

describe("apply_patch concurrent writers", () => {
  it("serializes concurrent patches to the same file", async () => {
    const fixture = await setup();
    await writeFile(fixture.path("a.txt"), "one\ntwo\n");

    await Promise.all([
      fixture.run(patch("*** Update File: a.txt", "@@", "-one", "+ONE")),
      fixture.run(patch("*** Update File: a.txt", "@@", "-two", "+TWO")),
    ]);

    expect(await fixture.read("a.txt")).toBe("ONE\nTWO\n");
  });

  it("waits for another tool holding the file's lock through a symlink", async () => {
    const fixture = await setup();
    await writeFile(fixture.path("real.txt"), "one\n");
    await symlink(fixture.path("real.txt"), fixture.path("link.txt"));
    let entered!: () => void;
    let release!: () => void;
    const holding = new Promise<void>((resolve) => { entered = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    const holder = withFileMutationQueue(fixture.path("link.txt"), async () => {
      entered();
      await held;
      await writeFile(fixture.path("real.txt"), "two\n");
    });
    await holding;

    const patching = fixture.run(patch("*** Update File: real.txt", "@@", "-two", "+three"));
    release();
    await Promise.all([holder, patching]);

    expect(await fixture.read("real.txt")).toBe("three\n");
  });
});

describe("apply_patch rollback", () => {
  it("restores files and permissions and removes created directories when a write fails", async () => {
    const fixture = await setup();
    await writeFile(fixture.path("a.txt"), "one\n");
    await writeFile(fixture.path("run.sh"), "echo hi\n");
    await chmod(fixture.path("run.sh"), 0o755);
    await writeFile(fixture.path("blocker"), "file\n");

    await expect(fixture.run(patch(
      "*** Update File: a.txt", "@@", "-one", "+two",
      "*** Delete File: run.sh",
      "*** Add File: nested/deep/x.txt", "+x",
      "*** Add File: blocker/child.txt", "+y",
    ))).rejects.toThrow(/^apply_patch failed, no files were changed: EEXIST/);

    expect(await fixture.read("a.txt")).toBe("one\n");
    expect(await fixture.read("run.sh")).toBe("echo hi\n");
    expect((await stat(fixture.path("run.sh"))).mode & 0o777).toBe(0o755);
    expect(await fixture.exists("nested")).toBe(false);
  });

  it("restores both sides of a move", async () => {
    const fixture = await setup();
    await writeFile(fixture.path("a.txt"), "one\n");
    await writeFile(fixture.path("b.txt"), "existing\n");
    await writeFile(fixture.path("blocker"), "file\n");

    await expect(fixture.run(patch(
      "*** Update File: a.txt", "*** Move to: b.txt", "@@", "-one", "+two",
      "*** Add File: blocker/child.txt", "+y",
    ))).rejects.toThrow("no files were changed");

    expect(await fixture.read("a.txt")).toBe("one\n");
    expect(await fixture.read("b.txt")).toBe("existing\n");
  });

  it("lists only the changed files it could not restore", async () => {
    const fixture = await setup();
    await writeFile(fixture.path("a.txt"), "one\n");
    await writeFile(fixture.path("b.txt"), "keep\n");
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let writes = 0;
    vi.mocked(writeFile).mockImplementation(async (...args) => {
      if (args[0] === fixture.path("b.txt")) throw new Error("disk full");
      if (args[0] === fixture.path("a.txt") && ++writes > 1) throw new Error("read-only");
      return actual.writeFile(...args);
    });
    onTestFinished(() => { vi.mocked(writeFile).mockImplementation(actual.writeFile); });

    await expect(fixture.run(patch(
      "*** Update File: a.txt", "@@", "-one", "+two", "*** Update File: b.txt", "@@", "-keep", "+changed",
    ))).rejects.toThrow(`apply_patch failed: disk full\nCould not restore: ${fixture.path("a.txt")}`);

    expect(await fixture.read("a.txt")).toBe("two\n");
    expect(await fixture.read("b.txt")).toBe("keep\n");
  });
});
