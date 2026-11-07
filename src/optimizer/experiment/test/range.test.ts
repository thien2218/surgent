import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import move from "../mover/index.js";
import patch from "../patcher/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe.each(["move", "patch"] as const)("%s boundary matching", (tool) => {
  async function setup(original: string) {
    const root = await mkdtemp(join(tmpdir(), "surgent-range-"));
    roots.push(root);
    await writeFile(join(root, "source"), original);
    await writeFile(join(root, "dest"), "target!");
    const context = { cwd: root } as ExtensionToolContext;
    return {
      run: (start: string, end: string) => {
        if (tool === "move") {
          return move.execute("range-test", {
            source: { file: "source", start, end },
            dest: { file: "dest", after: "target" },
          }, undefined, undefined, context);
        }
        return patch.execute("range-test", {
          file: "source",
          edits: [{ start, end, text: "" }],
        }, undefined, undefined, context);
      },
      contents: (file: string) => readFile(join(root, file), "utf8"),
    };
  }

  it.each([
    { original: "[one[two]tail[", start: "[", end: "]", selected: "[two]", expected: "[onetail[" },
    { original: "ab-midabc-tail", start: "ab", end: "bc", selected: "ab-midabc", expected: "-tail" },
    { original: "\ufeff'start'\nold\r\n‘start’  \r\nbody\r\nEND尾", start: "'start'\n", end: "END", selected: "‘start’  \r\nbody\r\nEND", expected: "\ufeff'start'\nold\r\n尾" },
    { original: "start-one-start—two-start-END!", start: "start-", end: "END", selected: "start-END", expected: "start-one-start—two-!" },
    { original: "start-one-start—two-END!", start: "start-", end: "END", selected: "start—two-END", expected: "start-one-!" },
  ])("selects the nearest valid boundary in '$original'", async ({ original, start, end, selected, expected }) => {
    const fixture = await setup(original);

    await fixture.run(start, end);

    expect(await fixture.contents("source")).toBe(expected);
    expect(await fixture.contents("dest")).toBe(tool === "move" ? `target${selected}!` : "target!");
  });

  it.each([
    { original: "start-one-start-END— END-", start: "start-", end: "END-", error: "ambiguous" },
    { original: "END[start[tail", start: "[", end: "END", error: "start was not found before end" },
    { original: "ababc", start: "ab", end: "babc", error: "start was not found before end" },
  ])("rejects unresolved boundaries in '$original' without writing", async ({ original, start, end, error }) => {
    const fixture = await setup(original);

    await expect(fixture.run(start, end)).rejects.toThrow(error);

    expect(await fixture.contents("source")).toBe(original);
    expect(await fixture.contents("dest")).toBe("target!");
  });
});
