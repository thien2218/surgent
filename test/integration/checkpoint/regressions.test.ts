import { lstat, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openCheckpointRepo } from "../../../src/checkpoint/git.js";
import { createSnapshot } from "../../../src/checkpoint/snapshot.js";
import { checkpointWorkspace } from "../../helpers/cleanup.js";
import { openCheckpointWorkspace } from "../../helpers/checkpoint.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const filesystem = await importOriginal<typeof import("node:fs/promises")>();
  return { ...filesystem, lstat: vi.fn(filesystem.lstat), readFile: vi.fn(filesystem.readFile), writeFile: vi.fn(filesystem.writeFile) };
});

afterEach(async () => {
  const filesystem = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.mocked(lstat).mockReset().mockImplementation(filesystem.lstat);
  vi.mocked(readFile).mockReset().mockImplementation(filesystem.readFile);
  vi.mocked(writeFile).mockReset().mockImplementation(filesystem.writeFile);
});

describe("checkpoint filesystem regressions", () => {
  it("tolerates an untracked file disappearing before its size check", async () => {
    const workspace = await openCheckpointWorkspace();
    await writeFile(join(workspace.cwd, "vanished"), "temporary");
    const filesystem = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(lstat).mockImplementation(async (...args) => {
      if (args[0] === join(workspace.cwd, "vanished")) {
        await filesystem.rm(args[0]);
        throw Object.assign(new Error("gone"), { code: "ENOENT" });
      }
      return filesystem.lstat(...args);
    });
    expect(await createSnapshot(workspace.api, workspace.repo)).toMatch(/^[0-9a-f]{40}$/);
  });

  it.each(["EACCES", "EIO"])("rejects an incomplete snapshot after file stat error %s", async (code) => {
    const workspace = await openCheckpointWorkspace();
    await writeFile(join(workspace.cwd, "unreadable"), "must not silently disappear");
    vi.mocked(lstat).mockRejectedValueOnce(Object.assign(new Error("stat failed"), { code }));
    await expect(createSnapshot(workspace.api, workspace.repo)).rejects.toMatchObject({ code });
    expect(workspace.checkpointGit(["ls-files"])).toBe("");
  });

  it.each(["EACCES", "EIO"])("preserves exclusions and rejects opening after source-exclude error %s", async (code) => {
    const workspace = await openCheckpointWorkspace();
    const source = join(workspace.cwd, ".git", "info", "exclude");
    await writeFile(source, "private\n");
    await openCheckpointRepo(workspace.api, workspace.cwd);
    await writeFile(join(workspace.cwd, "private"), "fake private data");
    const filesystem = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(readFile).mockImplementation(async (...args) => {
      if (args[0] === source) throw Object.assign(new Error("exclude read failed"), { code });
      return filesystem.readFile(...args);
    });
    await expect(openCheckpointRepo(workspace.api, workspace.cwd)).rejects.toMatchObject({ code });
    expect(await readFile(join(workspace.directory, ".git", "info", "exclude"), "utf8")).toBe("private\n");
    expect(workspace.checkpointGit(["ls-files", "--others", "--exclude-standard"])).toBe("");
  });

  it("repairs failed initialization before capturing tracked oversized files", async () => {
    const workspace = await checkpointWorkspace();
    await writeFile(join(workspace.cwd, "tracked"), Buffer.alloc(2 * 1024 * 1024 + 1, 120));
    workspace.git(workspace.cwd, ["add", "tracked"]);
    const filesystem = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(writeFile).mockImplementation(async (...args) => {
      if (args[0] === join(workspace.directory, ".git", "objects", "info", "alternates")) {
        throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
      }
      return filesystem.writeFile(...args);
    });
    expect(await openCheckpointRepo(workspace.api, workspace.cwd)).toBeUndefined();
    vi.mocked(writeFile).mockImplementation(filesystem.writeFile);
    const reopened = await openCheckpointRepo(workspace.api, workspace.cwd);
    expect(reopened).toBeDefined();
    const tree = await createSnapshot(workspace.api, reopened!);
    expect(workspace.git(workspace.directory, ["ls-tree", "--name-only", tree!])).toBe("tracked");
  });
});
