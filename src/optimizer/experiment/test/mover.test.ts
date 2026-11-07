import { mkdtemp, readFile, rm, writeFile, symlink, link } from "node:fs/promises";
import * as filesystem from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import move, { type MoveInput } from "../mover/index.js";

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});

const roots: string[] = [];
afterEach(async () => {
  vi.mocked(filesystem.writeFile).mockReset();
  vi.mocked(filesystem.writeFile).mockImplementation((await vi.importActual<typeof filesystem>("node:fs/promises")).writeFile);
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup(source = "before[block]after", dest = "target!") {
  const root = await mkdtemp(join(tmpdir(), "surgent-mover-"));
  roots.push(root);
  await writeFile(join(root, "source"), source);
  await writeFile(join(root, "dest"), dest);
  const input: MoveInput = {
    source: { file: "source", start: "[", end: "]" },
    dest: { file: "dest", after: "target" },
  };
  return {
    root,
    input,
    run: (params: MoveInput = input, signal?: AbortSignal) => move.execute("move-test", params, signal, undefined, { cwd: root } as ExtensionToolContext),
    contents: (file: string) => readFile(join(root, file), "utf8"),
  };
}

describe("move tool", () => {
  it.each([true, false, undefined])("duplicate=%s transfers inclusive text without adding whitespace", async (duplicate) => {
    const fixture = await setup();

    const result = await fixture.run({ ...fixture.input, duplicate });

    expect(await fixture.contents("dest")).toBe("target[block]!");
    expect(await fixture.contents("source")).toBe(duplicate ? "before[block]after" : "beforeafter");
    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("Successfully") });
  });

  it.each([
    { source: "target![block]after", expected: "target[block]!after" },
    { source: "before[block]target!", expected: "beforetarget[block]!" },
  ])("cuts within one file while adjusting destination offsets", async ({ source, expected }) => {
    const fixture = await setup(source);

    await fixture.run({ ...fixture.input, dest: { file: "source", after: "target" } });

    expect(await fixture.contents("source")).toBe(expected);
  });

  it("copies within a block using the original destination", async () => {
    const fixture = await setup();

    await fixture.run({ ...fixture.input, duplicate: true, dest: { file: "source", after: "block" } });

    expect(await fixture.contents("source")).toBe("before[block[block]]after");
  });

  it("uses the first end after start, including when an earlier end needs fuzzy matching", async () => {
    const fixture = await setup("END[one—two-END");

    await fixture.run({ ...fixture.input, source: { file: "source", start: "[", end: "-" } });

    expect(await fixture.contents("dest")).toBe("target[one—!");
    expect(await fixture.contents("source")).toBe("ENDtwo-END");
  });

  it("does not reuse the start occurrence as the end", async () => {
    const fixture = await setup("a|z");

    await expect(fixture.run({ ...fixture.input, source: { file: "source", start: "|", end: "|" } })).rejects.toThrow("source.end was not found");
    expect(await fixture.contents("source")).toBe("a|z");
  });

  it("preserves CRLF, BOM, Unicode and trailing whitespace when matching normalized anchors", async () => {
    const source = "\ufeffintro\r\n[‘start’  \r\nbody\r\nend]tail";
    const fixture = await setup(source);

    await fixture.run({ ...fixture.input, source: { file: "source", start: "['start'\n", end: "end]" } });

    expect(await fixture.contents("dest")).toBe("target[‘start’  \r\nbody\r\nend]!");
    expect(await fixture.contents("source")).toBe("\ufeffintro\r\ntail");
  });

  it.each([
    { start: "missing", end: "]", after: "target", error: "source.start was not found" },
    { start: "[", end: "missing", after: "target", error: "source.end was not found" },
    { start: "[", end: "]", after: "missing", error: "dest.after was not found" },
    { start: "", end: "]", after: "target", error: "must not be empty" },
  ])("leaves files unchanged on invalid anchors: $error", async ({ start, end, after, error }) => {
    const fixture = await setup();

    await expect(fixture.run({ ...fixture.input, source: { file: "source", start, end }, dest: { file: "dest", after } })).rejects.toThrow(error);

    expect(await fixture.contents("source")).toBe("before[block]after");
    expect(await fixture.contents("dest")).toBe("target!");
  });

  it.each([
    { source: "[one][two]", dest: "target!" },
    { source: "[one]", dest: "target target" },
    { source: "[one]", dest: "target— target-" },
  ])("rejects ambiguous anchors, including fuzzy equivalents", async ({ source, dest }) => {
    const fixture = await setup(source, dest);
    const after = dest.includes("target—") ? "target-" : "target";

    await expect(fixture.run({ ...fixture.input, dest: { file: "dest", after } })).rejects.toThrow("ambiguous");

    expect(await fixture.contents("source")).toBe(source);
    expect(await fixture.contents("dest")).toBe(dest);
  });

  it("rejects a cut into its own block through a symlink alias", async () => {
    const fixture = await setup();
    await symlink(join(fixture.root, "source"), join(fixture.root, "alias"));

    await expect(fixture.run({ ...fixture.input, dest: { file: "alias", after: "block" } })).rejects.toThrow("into itself");

    expect(await fixture.contents("source")).toBe("before[block]after");
  });

  it("rejects hard-linked source and destination without losing text", async () => {
    const fixture = await setup();
    await link(join(fixture.root, "source"), join(fixture.root, "alias"));

    await expect(fixture.run({ ...fixture.input, dest: { file: "alias", after: "after" } })).rejects.toThrow("hard links");

    expect(await fixture.contents("source")).toBe("before[block]after");
  });

  it("rejects invalid UTF-8 without rewriting bytes", async () => {
    const fixture = await setup();
    const bytes = Buffer.from([0x5b, 0xff, 0x5d]);
    await writeFile(join(fixture.root, "source"), bytes);

    await expect(fixture.run()).rejects.toThrow("UTF-8");

    expect(await readFile(join(fixture.root, "source"))).toEqual(bytes);
    expect(await fixture.contents("dest")).toBe("target!");
  });

  it("restores both files if a source write partially fails after destination write", async () => {
    const fixture = await setup();
    const actual = await vi.importActual<typeof filesystem>("node:fs/promises");
    let writes = 0;
    vi.mocked(filesystem.writeFile).mockImplementation(async (...args) => {
      writes++;
      if (writes === 2) {
        await actual.writeFile(args[0], "partial");
        throw new Error("disk failure");
      }
      return actual.writeFile(...args);
    });

    await expect(fixture.run()).rejects.toThrow("disk failure");

    expect(await fixture.contents("source")).toBe("before[block]after");
    expect(await fixture.contents("dest")).toBe("target!");
  });

  it("leaves files unchanged when cancelled before execution", async () => {
    const fixture = await setup();
    const controller = new AbortController();
    controller.abort();

    await expect(fixture.run(fixture.input, controller.signal)).rejects.toThrow();

    expect(await fixture.contents("source")).toBe("before[block]after");
    expect(await fixture.contents("dest")).toBe("target!");
  });

  it("serializes concurrent moves so neither destination insertion is lost", async () => {
    const fixture = await setup();

    await Promise.all([
      fixture.run({ ...fixture.input, duplicate: true }),
      fixture.run({ ...fixture.input, duplicate: true }),
    ]);

    expect(await fixture.contents("dest")).toBe("target[block][block]!");
  });
});
