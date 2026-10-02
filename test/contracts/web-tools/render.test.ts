import type { Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { expect, it } from "vitest";
import webTools from "../../../src/web-tools/index.js";
import { recordExtension } from "../../helpers/extension.js";

function setup() {
  const extension = recordExtension();
  webTools(extension.api);
  const theme = { fg: (_color: string, text: string) => text, underline: (text: string) => text } as Theme;
  return { extension, theme };
}

it("registers supported tools, parameter constraints, and login command", () => {
  const { extension } = setup();
  expect(extension.tool("web_search").parameters).toMatchObject({
    type: "object", properties: { query: { type: "string" }, max: { type: "number", minimum: 1, maximum: 10 }, news: { type: "boolean" } },
  });
  expect(extension.tool("web_fetch").parameters).toMatchObject({ type: "object", properties: { url: { type: "string" } } });
  expect(extension.command("web-login").description).toContain("API keys");
});
it.each([true, false])("renders fetch calls with partial=%s", isPartial => {
  const { extension, theme } = setup();
  const tool = extension.tool("web_fetch");
  const options = { isPartial } as Parameters<NonNullable<typeof tool.renderCall>>[2];
  const rendered = tool.renderCall?.({ url: "https://example.invalid" }, theme, options);
  const text = stripTerminalSequences(rendered?.render(80).join("\n") ?? "");
  expect(text).toContain("web_fetch");
  expect(text).toContain("https://example.invalid");
});
it("renders search query and a pending search result", () => {
  const { extension, theme } = setup();
  const tool = extension.tool("web_search");
  const call = tool.renderCall?.({ query: "search phrase" }, theme, { isPartial: false } as Parameters<NonNullable<typeof tool.renderCall>>[2]);
  expect(stripTerminalSequences(call?.render(80).join("\n") ?? "")).toContain("search phrase");
  const result = tool.renderResult?.({ content: [], details: undefined }, { isPartial: true, expanded: false }, theme, {} as Parameters<NonNullable<typeof tool.renderResult>>[3]);
  expect(stripTerminalSequences(result?.render(80).join("\n") ?? "")).toContain("Searching...");
});
it.each([false, true])("renders result URLs with expanded=%s", expanded => {
  const { extension, theme } = setup();
  const tool = extension.tool("web_search");
  const options = { isPartial: false, expanded } as Parameters<NonNullable<typeof tool.renderResult>>[1];
  const result = tool.renderResult?.({ content: [], details: { results: [{ title: "Title", url: "https://example.invalid", description: "Summary" }] } }, options, theme, {} as Parameters<NonNullable<typeof tool.renderResult>>[3]);
  expect(stripTerminalSequences(result?.render(80).join("\n") ?? "").trimEnd()).toBe("https://example.invalid");
  const missing = tool.renderResult?.({ content: [], details: undefined }, options, theme, {} as Parameters<NonNullable<typeof tool.renderResult>>[3]);
  expect(stripTerminalSequences(missing?.render(80).join("\n") ?? "").trimEnd()).toBe("No search results");
});
