import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import * as filesystem from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withFileMutationQueue, type ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import patch, { type PatchInput } from "../patcher/index.js";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});

const roots: string[] = [];
beforeEach(async () => {
  const actual = await vi.importActual<typeof filesystem>("node:fs/promises");
  vi.mocked(filesystem.writeFile).mockReset().mockImplementation(actual.writeFile);
});
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup(original = "before[body]after") {
  const root = await mkdtemp(join(tmpdir(), "surgent-patcher-"));
  roots.push(root);
  const file = join(root, "file");
  await writeFile(file, original);
  return {
    root,
    file,
    run: (edits: PatchInput["edits"], path = "file", signal?: AbortSignal) =>
      patch.execute("patch-test", { file: path, edits }, signal, undefined, { cwd: root } as ExtensionToolContext),
    contents: () => readFile(file, "utf8"),
  };
}

describe("experimental patch tool", () => {
  it.each([
    { text: "new", expected: "beforenewafter" },
    { text: "", expected: "beforeafter" },
  ])("replaces the inclusive range with '$text'", async ({ text, expected }) => {
    const fixture = await setup();

    const result = await fixture.run([{ start: "[", end: "]", text }]);

    expect(await fixture.contents()).toBe(expected);
    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("Successfully") });
  });

  it("inserts verbatim after a unique literal anchor without adding formatting", async () => {
    const fixture = await setup(".*[body]after");

    await fixture.run([{ appendTo: ".*", text: "\tinsert\r\n" }], "@file");

    expect(await fixture.contents()).toBe(".*\tinsert\r\n[body]after");
  });

  it.each([
    { edits: [{ appendTo: " ", text: "!" }], expected: "prefix !body\tend" },
    { edits: [{ start: " ", end: "\t", text: "new" }], expected: "prefixnewend" },
  ])("accepts unique whitespace-only anchors without discarding their exact matches", async ({ edits, expected }) => {
    const fixture = await setup("prefix body\tend");

    await fixture.run(edits);

    expect(await fixture.contents()).toBe(expected);
  });

  it("matches every edit against the original file regardless of input order", async () => {
    const fixture = await setup("a[old]b<old>c");

    await fixture.run([
      { start: "<", end: ">", text: "[old]" },
      { appendTo: "b", text: "!" },
      { start: "[", end: "]", text: "first" },
    ]);

    expect(await fixture.contents()).toBe("afirstb![old]c");
  });

  it("cannot target an anchor introduced by an earlier edit", async () => {
    const fixture = await setup();

    await expect(fixture.run([
      { start: "[", end: "]", text: "introduced" },
      { appendTo: "introduced", text: "!" },
    ])).rejects.toThrow("appendTo was not found");

    expect(await fixture.contents()).toBe("before[body]after");
  });

  it("selects the first end after the full start, even when that end needs fuzzy matching", async () => {
    const fixture = await setup("END[one—two-END");

    await fixture.run([{ start: "[", end: "-", text: "new" }]);

    expect(await fixture.contents()).toBe("ENDnewtwo-END");
  });

  it("does not reuse the start occurrence as the end", async () => {
    const fixture = await setup("a|z");

    await expect(fixture.run([{ start: "|", end: "|", text: "new" }])).rejects.toThrow("end was not found");
    expect(await fixture.contents()).toBe("a|z");

  });

  it("does not select an end overlapping the full start anchor", async () => {
    const fixture = await setup("abc-tail-bc!");

    await fixture.run([{ start: "abc", end: "bc", text: "new" }]);

    expect(await fixture.contents()).toBe("new!");
  });

  it.each([
    { edits: [], error: "at least one edit" },
    { edits: [{ start: "", end: "]", text: "new" }], error: "start must not be empty" },
    { edits: [{ start: "[", end: "", text: "new" }], error: "end must not be empty" },
    { edits: [{ appendTo: "", text: "new" }], error: "appendTo must not be empty" },
    { edits: [{ start: "missing", end: "]", text: "new" }], error: "start was not found" },
    { edits: [{ start: "[", end: "missing", text: "new" }], error: "end was not found" },
    { edits: [{ appendTo: "missing", text: "new" }], error: "appendTo was not found" },
  ])("rejects invalid input without changing the file: $error", async ({ edits, error }) => {
    const fixture = await setup();

    await expect(fixture.run(edits)).rejects.toThrow(error);

    expect(await fixture.contents()).toBe("before[body]after");
  });

  it.each([
    { original: "[one][two]", edits: [{ start: "[", end: "]", text: "new" }] },
    { original: "target— target-", edits: [{ appendTo: "target-", text: "!" }] },
    { original: "aaa", edits: [{ appendTo: "aa", text: "!" }] },
  ])("rejects ambiguous anchors, including fuzzy and overlapping occurrences", async ({ original, edits }) => {
    const fixture = await setup(original);

    await expect(fixture.run(edits)).rejects.toThrow("ambiguous");

    expect(await fixture.contents()).toBe(original);
  });

  it.each([
    [{ start: "[", end: "]", text: "first" }, { start: "body", end: "after", text: "second" }],
    [{ start: "[", end: "]", text: "first" }, { start: "body", end: "]", text: "second" }],
    [{ start: "[", end: "]", text: "first" }, { appendTo: "body", text: "inside" }],
  ] satisfies PatchInput["edits"][])("rejects overlapping replacements and interior insertions", async (...edits) => {
    const fixture = await setup();

    await expect(fixture.run(edits)).rejects.toThrow("overlap");

    expect(await fixture.contents()).toBe("before[body]after");
  });

  it("rejects insertions at the same position even when anchors differ", async () => {
    const fixture = await setup();

    await expect(fixture.run([
      { appendTo: "before", text: "first" },
      { appendTo: "fore", text: "second" },
    ])).rejects.toThrow("same position");

    expect(await fixture.contents()).toBe("before[body]after");
  });

  it("allows adjacent replacements and boundary insertions in original-position order", async () => {
    const fixture = await setup("prefix[a][b]suffix");

    await fixture.run([
      { start: "[b", end: "]", text: "B" },
      { appendTo: "[a]", text: "between" },
      { appendTo: "[b]", text: "after" },
      { start: "[a", end: "]", text: "A" },
      { appendTo: "prefix", text: "before" },
    ]);

    expect(await fixture.contents()).toBe("prefixbeforeAbetweenBaftersuffix");
  });

  it("preserves outside bytes and inserted text when anchors need normalized matching", async () => {
    const fixture = await setup("\ufeff😀intro \r\n[‘start’  \r\nbody\rend]尾\t \nlast\r\n");

    await fixture.run([{ start: "['start'\n", end: "end]", text: "Ｎew\r\n\t" }]);

    expect(await readFile(fixture.file)).toEqual(Buffer.from("\ufeff😀intro \r\nＮew\r\n\t尾\t \nlast\r\n"));
  });

  it("rejects invalid UTF-8 without rewriting bytes", async () => {
    const fixture = await setup();
    const bytes = Buffer.from([0x5b, 0xff, 0x5d]);
    await writeFile(fixture.file, bytes);

    await expect(fixture.run([{ start: "[", end: "]", text: "new" }])).rejects.toThrow("UTF-8");

    expect(await readFile(fixture.file)).toEqual(bytes);
  });

  it("restores original bytes after a partial write failure", async () => {
    const fixture = await setup();
    const actual = await vi.importActual<typeof filesystem>("node:fs/promises");
    vi.mocked(filesystem.writeFile).mockImplementationOnce(async (path) => {
      await actual.writeFile(path, "partial");
      throw new Error("disk failure");
    });

    await expect(fixture.run([{ start: "[", end: "]", text: "new" }])).rejects.toThrow("disk failure");

    expect(await fixture.contents()).toBe("before[body]after");
  });

  it("reports failed restoration instead of claiming the file was restored", async () => {
    const fixture = await setup();
    const actual = await vi.importActual<typeof filesystem>("node:fs/promises");
    const writeError = new Error("disk failure");
    const restoreError = new Error("restore failure");
    vi.mocked(filesystem.writeFile).mockImplementationOnce(async (path) => {
      await actual.writeFile(path, "partial");
      throw writeError;
    }).mockRejectedValueOnce(restoreError);

    await expect(fixture.run([{ start: "[", end: "]", text: "new" }])).rejects.toMatchObject({
      message: expect.stringContaining("could not restore"),
      errors: [writeError, restoreError],
    });

    expect(await fixture.contents()).toBe("partial");
  });

  it("leaves files unchanged when cancelled before execution", async () => {
    const fixture = await setup();
    const controller = new AbortController();
    controller.abort();

    await expect(fixture.run([{ appendTo: "before", text: "!" }], "file", controller.signal)).rejects.toThrow();

    expect(await fixture.contents()).toBe("before[body]after");
  });

  it("queues the entire mutation behind Pi mutations, including through symlink aliases", async () => {
    const fixture = await setup();
    await symlink(fixture.file, join(fixture.root, "alias"));

    await withFileMutationQueue(fixture.file, async () => {
      const pending = fixture.run([{ appendTo: "queued", text: "!" }], "alias");
      await writeFile(fixture.file, "queued");
      return { pending };
    }).then(({ pending }) => pending);

    expect(await fixture.contents()).toBe("queued!");
  });

  it("serializes concurrent patches without losing either insertion", async () => {
    const fixture = await setup();

    await Promise.all([
      fixture.run([{ appendTo: "before", text: "!" }]),
      fixture.run([{ appendTo: "before", text: "!" }]),
    ]);

    expect(await fixture.contents()).toBe("before!![body]after");
  });
});
