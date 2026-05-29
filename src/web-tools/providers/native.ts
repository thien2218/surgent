import TurndownService from "turndown";
import {
  formatErrorMessage,
  getHttpError,
  isTextLikeContentType,
  normalizeFetchedContent,
} from "../web-fetch/helpers.js";
import type { WebFetchResponse } from "../web-fetch/types.js";
import type { WebFetchProvider } from "./index.js";

export class NativeWebFetchProvider implements WebFetchProvider {
  private readonly turndown = new TurndownService();

  async fetch(url: string): Promise<WebFetchResponse> {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "text/html, text/plain, text/markdown;q=0.9, */*;q=0.1",
        },
      });

      if (!response.ok) {
        throw new Error(await getHttpError(response));
      }

      const contentType = response.headers.get("content-type");
      if (!isTextLikeContentType(contentType)) {
        throw new Error(`Unsupported content type: ${contentType ?? "unknown"}`);
      }

      const rawBody = await response.text();
      const content = this.normalizeContent(rawBody, contentType);

      if (!content) {
        throw new Error("Native fetch returned empty content.");
      }

      return { provider: "native", content, url };
    } catch (error) {
      return { provider: "native", url, error: formatErrorMessage(error) };
    }
  }

  private normalizeContent(body: string, contentType: string | null): string {
    if (this.looksLikeHtml(body, contentType)) {
      return normalizeFetchedContent(this.turndown.turndown(body));
    }

    return normalizeFetchedContent(body);
  }

  private looksLikeHtml(body: string, contentType: string | null): boolean {
    const normalizedType = (contentType ?? "").toLowerCase();

    return normalizedType.includes("html") || /<html[\s>]/i.test(body) || /<body[\s>]/i.test(body);
  }
}
