import { expect, it } from "vitest";
import { getValidatedUrl, isTextLikeContentType, normalizeFetchedContent } from "../../../src/web-tools/web-fetch/helpers.js";
import { parseWebFetchContent } from "../../../src/web-tools/web-fetch/parser.js";

it("trims and canonicalizes HTTP URLs", () => {
  expect(getValidatedUrl(" HTTPS://EXAMPLE.INVALID:443 ")).toBe("https://example.invalid/");
  expect(getValidatedUrl("http://example.invalid/path?q=1#part")).toBe("http://example.invalid/path?q=1#part");
});
it.each(["", "   ", "not a URL", "ftp://example.invalid", "file:///tmp/page"])("rejects unsupported URL %j", value => {
  expect(() => getValidatedUrl(value)).toThrow();
});
it.each([null, "text/plain", "TEXT/HTML; charset=utf-8", "text/markdown", "application/json", "application/xml", "application/javascript"])("accepts text-like response type %j", value => {
  expect(isTextLikeContentType(value)).toBe(true);
});
it.each(["image/png", "application/octet-stream", "application/pdf"])("rejects binary response type %s", value => {
  expect(isTextLikeContentType(value)).toBe(false);
});
it("normalizes fetched whitespace and Windows newlines", () => {
  expect(normalizeFetchedContent(" \r\n# Title\r\nbody \r\n")).toBe("# Title\nbody");
  expect(normalizeFetchedContent(undefined)).toBe("");
});
it("outlines nested headings with one-based inclusive section ranges", () => {
  const markdown = ["# Parent", "intro", "## Child ##", "body", "### Leaf", "leaf", "## Sibling", "sibling", "# Next", "end"].join("\n");
  expect(parseWebFetchContent(markdown)).toBe([
    "# Parent (L1-8)", "  ## Child (L3-6)", "    ### Leaf (L5-6)", "  ## Sibling (L7-8)", "# Next (L9-10)",
  ].join("\n"));
});
it.each(["```", "~~~"])("ignores headings inside %s code fences", fence => {
  expect(parseWebFetchContent([fence, "# Hidden", fence, "# Visible"].join("\n"))).toBe("# Visible (L4-4)");
});
it("supports heading levels one through five and ignores plain text", () => {
  expect(parseWebFetchContent("plain\n##### Deep\n###### Not indexed")).toBe("        ##### Deep (L2-3)");
  expect(parseWebFetchContent("plain text\nno headings")).toBe("");
});
it("keeps headings inside an unclosed fence out of the outline", () => {
  expect(parseWebFetchContent("# Before\n```ts\n# Hidden")).toBe("# Before (L1-3)");
});
