import TurndownService from "turndown";
import {
  formatErrorMessage,
  getHttpError,
  isTextLikeContentType,
  normalizeFetchedContent,
} from "../web-fetch/helpers.js";
import type {
  WebFetchFailure,
  WebFetchProviderResponse,
  WebFetchResult,
} from "../web-fetch/types.js";
import type { WebFetchProvider } from "./index.js";

export class NativeWebFetchProvider implements WebFetchProvider {
  private readonly turndown = new TurndownService();

  async fetch(urls: string[]): Promise<WebFetchProviderResponse> {
    const settled = await Promise.all(urls.map(async (url) => this.fetchSingleUrl(url)));

    return {
      failures: settled.flatMap((item) => item.failure ?? []),
      results: settled.flatMap((item) => item.result ?? []),
    };
  }

  private async fetchSingleUrl(url: string): Promise<{
    result?: WebFetchResult;
    failure?: WebFetchFailure;
  }> {
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

      return {
        result: { content, provider: "native", url },
      };
    } catch (error) {
      return {
        failure: { message: formatErrorMessage(error), provider: "native", url },
      };
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
