import { describe, expect, it } from "vitest";
import { isDefined, isMissingFileError, isRecord, isUuidv7, normalizeText, tokenizeArgs, unique } from "../../../src/utils.js";

describe("text normalization", () => {
  it.each([
    { input: " \n hello world\t", expected: "hello world" },
    { input: " \t\n", expected: "" },
    { input: 42, expected: "" },
    { input: null, expected: "" },
    { input: undefined, expected: "" },
    { input: { toString: () => "not text" }, expected: "" },
  ])("normalizes $input to $expected", ({ input, expected }) => {
    expect(normalizeText(input)).toBe(expected);
  });

  it("splits command arguments on whitespace without empty tokens", () => {
    expect(tokenizeArgs(" \tcode  --wait\nfile.ts ")).toEqual(["code", "--wait", "file.ts"]);
    expect(tokenizeArgs(" \t\n")).toEqual([]);
  });
});

describe("unique values", () => {
  it("keeps first occurrence order without modifying the input", () => {
    const values = [3, 1, 3, 2, 1];

    expect(unique(values)).toEqual([3, 1, 2]);
    expect(values).toEqual([3, 1, 3, 2, 1]);
  });

  it("accepts any iterable and preserves distinct object identities", () => {
    const first = { value: 1 };
    const second = { value: 1 };
    const values = new Map([[0, first], [1, second], [2, first]]);

    const result = unique(values.values());

    expect(result).toHaveLength(2);
    expect(result[0]).toBe(first);
    expect(result[1]).toBe(second);
    expect(unique([])).toEqual([]);
  });
});

describe("value guards", () => {
  it.each([
    { value: undefined, expected: false },
    { value: null, expected: true },
    { value: false, expected: true },
    { value: 0, expected: true },
    { value: "", expected: true },
  ])("treats $value as defined: $expected", ({ value, expected }) => {
    expect(isDefined(value)).toBe(expected);
  });

  it.each([
    { value: {}, expected: true },
    { value: { enabled: false }, expected: true },
    { value: Object.create(null), expected: true },
    { value: null, expected: false },
    { value: undefined, expected: false },
    { value: [], expected: false },
    { value: "record", expected: false },
    { value: 42, expected: false },
    { value: () => ({}), expected: false },
  ])("recognizes record $value: $expected", ({ value, expected }) => {
    expect(isRecord(value)).toBe(expected);
  });

  it.each([
    { error: Object.assign(new Error("missing"), { code: "ENOENT" }), expected: true },
    { error: { code: "EACCES" }, expected: false },
    { error: new Error("ENOENT"), expected: false },
    { error: null, expected: false },
    { error: undefined, expected: false },
    { error: "ENOENT", expected: false },
  ])("recognizes only missing-file errors: $error", ({ error, expected }) => {
    expect(isMissingFileError(error)).toBe(expected);
  });
});

describe("UUID v7 validation", () => {
  it.each(["8", "9", "a", "b"])("accepts variant %s with either hex case", (variant) => {
    const uuid = `01932b80-9f16-7abc-${variant}def-0123456789ab`;

    expect(isUuidv7(uuid)).toBe(true);
    expect(isUuidv7(uuid.toUpperCase())).toBe(true);
  });

  it.each([
    "01932b80-9f16-4abc-8def-0123456789ab",
    "01932b80-9f16-7abc-7def-0123456789ab",
    "01932b80-9f16-7abc-cdef-0123456789ab",
    "01932b80-9f16-7abc-8def-0123456789ag",
    "01932b809f167abc8def0123456789ab",
    "01932b80-9f16-7abc-8def-0123456789a",
    " 01932b80-9f16-7abc-8def-0123456789ab",
    "01932b80-9f16-7abc-8def-0123456789ab-extra",
  ])("rejects invalid UUID %s", (uuid) => {
    expect(isUuidv7(uuid)).toBe(false);
  });
});
