import { describe, expect, it } from "vitest";
import { BashResultReducer } from "../../../src/optimizer/reducer/bash.js";
import { formatGrepResult } from "../../../src/optimizer/reducer/grep.js";

function reduce(chunks: Buffer[]) {
  const output: Buffer[] = [];
  const reducer = new BashResultReducer((data) => output.push(data));
  for (const chunk of chunks) reducer.append(chunk);
  reducer.finish();
  return Buffer.concat(output).toString("utf8");
}

// Reference expansion of the public text format, not reducer internals.
function expand(output: Buffer) {
  const lines = output.toString("latin1").match(/[^\n]*\n|[^\n]+$/g) ?? [];
  return Buffer.from(lines.map((line) => {
    const markers = /\\[{}]|{([A-Za-z0-9]+(?:, [A-Za-z0-9]+)+)}/g;
    const values = Array.from(line.matchAll(markers)).find((match) => match[1]);
    if (!values) return line.replace(/\\([{}])/g, "$1");
    return values[1]!.split(", ").map((value) =>
      line.replace(markers, (marker, list) => list ? value : marker.slice(1)),
    ).join("");
  }).join(""), "latin1");
}

describe("BashResultReducer", () => {
  it("preserves UTF-8, ANSI, and carriage returns regardless of stream fragmentation", () => {
    const input = Buffer.from("\u001b[31mcafé 🦊\u001b[0m\r\nloading 1\rloading 2\r\nend");

    expect(reduce([input])).toBe(input.toString());
    expect(reduce(Array.from(input, (byte) => Buffer.from([byte])))).toBe(input.toString());
    for (let offset = 1; offset < input.length; offset++) {
      expect(reduce([input.subarray(0, offset), input.subarray(offset)]), `split at byte ${offset}`).toBe(input.toString());
    }
  });

  it.each(["", "\n", "last line", "last line\n", "old\rnew", "progress\r", "progress\r\u001b[0m\r\n"])(
    "preserves content and newline state for %j", (input) => {
      expect(reduce([Buffer.from(input)])).toBe(input);
    },
  );

  it("factors consecutive statuses in order, including duplicates", () => {
    const input = ["204", "404", "404", "500"].map((status) => `GET /api/post/ resolves to ${status}\n`).join("");

    expect(reduce([Buffer.from(input)])).toBe("GET /api/post/ resolves to {204, 404, 404, 500}\n");
  });

  it("preserves exact repeat counts and later occurrences", () => {
    const line = "Downloading package 100\n";
    const input = line.repeat(3) + "OK\n" + line;

    expect(reduce([Buffer.from(input)])).toBe("Downloading package {100, 100, 100}\nOK\n" + line);
  });

  it("ends groups when another token, a separator, or a line ending changes", () => {
    const input = "GET /api/post/ resolves to 204\nGET /api/post/ resolves to 404\nGET /api/user/ resolves to 500\nGET /api/user/ resolves to 501\r\nGET /api/user/ resolves to 502!\r\n";

    expect(reduce([Buffer.from(input)])).toBe(
      "GET /api/post/ resolves to {204, 404}\nGET /api/user/ resolves to 500\nGET /api/user/ resolves to 501\r\nGET /api/user/ resolves to 502!\r\n",
    );
  });

  it("only factors complete lines when the encoding saves bytes", () => {
    const input = "1\n2\nsame\nsame\nGET /api/post/ resolves to 204\nGET /api/post/ resolves to 404";

    expect(reduce([Buffer.from(input)])).toBe(input);
  });

  it("distinguishes literal braces from inline value lists", () => {
    const input = "GET /api/{post}/ resolves to {204}\nGET /api/{post}/ resolves to {404}\nGET /api/{post}/ resolves to {500}\nliteral {204, 404}\n100%";

    expect(reduce([Buffer.from(input)])).toBe(
      "GET /api/\\{post\\}/ resolves to \\{{204, 404, 500}\\}\nliteral \\{204, 404\\}\n100%",
    );
  });

  it("round-trips raw bytes and framed groups across every chunk boundary", () => {
    const input = Buffer.concat([
      Buffer.from([0xff, 0x00, 0xc3, 0x0a]),
      Buffer.from("\ufeffcafé 🦊\r\n\u001b[31m100%\u001b[0m\rloading\n\n"),
      Buffer.from("GET /api/{{post}}/ resolves to {204}\r\nGET /api/{{post}}/ resolves to {404}\r\nGET /api/{{post}}/ resolves to {404}\r\n"),
      Buffer.from("literal {204, 404}\nDownloading package 100\n".repeat(2)),
      Buffer.from("GET /api/post/ resolves to {500}"),
    ]);

    for (let offset = 0; offset <= input.length; offset++) {
      const output: Buffer[] = [];
      const reducer = new BashResultReducer((data) => output.push(data));
      reducer.append(input.subarray(0, offset));
      reducer.append(input.subarray(offset));
      reducer.finish();
      expect(expand(Buffer.concat(output)), `split at byte ${offset}`).toEqual(input);
    }
  });

  it("flushes long matching runs before finish without losing lines", () => {
    const input = Buffer.from("GET /api/post/ resolves to 204\n".repeat(3000));
    const output: Buffer[] = [];
    const reducer = new BashResultReducer((data) => output.push(data));
    reducer.append(input);

    expect(output.length).toBeGreaterThan(0);
    reducer.finish();
    expect(expand(Buffer.concat(output))).toEqual(input);
  });

  it("streams settled lines before finish and flushes pending output only once", () => {
    const output: Buffer[] = [];
    const reducer = new BashResultReducer((data) => output.push(data));
    reducer.append(Buffer.from("first\nsecond line\npartial"));

    expect(Buffer.concat(output).toString()).toBe("first\n");
    reducer.finish();
    expect(Buffer.concat(output).toString()).toBe("first\nsecond line\npartial");
    reducer.finish();
    expect(Buffer.concat(output).toString()).toBe("first\nsecond line\npartial");
  });
});

describe("grep formatting", () => {
  it("merges overlapping context and promotes duplicates to matches without losing file ownership", () => {
    const output = formatGrepResult([
      "src/first.ts-9- before",
      "src/first.ts-10- hit",
      "src/first.ts:10: hit",
      "src/first.ts-10- hit",
      "src/first.ts:11: next hit",
      "src/second.ts:10: other hit",
      "src/first.ts:10: hit",
      "src/first.ts:20: later hit",
    ].join("\n"));

    expect(output).toEqual([
      "src/first.ts", "9- before", "10: hit", "11: next hit",
      "src/second.ts", "10: other hit", "src/first.ts", "20: later hit",
    ]);
  });

  it("keeps blank match text, colon-bearing paths, and trailing limit notices", () => {
    expect(formatGrepResult("src/a:b.ts:4: \n\n[100 matches limit reached. Use limit=200 for more]")).toEqual([
      "src/a:b.ts", "4: ", "", "[100 matches limit reached. Use limit=200 for more]",
    ]);
    expect(formatGrepResult("No matches found")).toEqual(["No matches found"]);
  });
});
