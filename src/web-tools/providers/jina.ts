import { formatErrorMessage, getHttpError, normalizeFetchedContent } from "../web-fetch/helpers.js";
import type {
  WebFetchFailure,
  WebFetchProviderResponse,
  WebFetchResult,
} from "../web-fetch/types.js";
import type { WebFetchProvider } from "./index.js";

export class JinaWebFetchProvider implements WebFetchProvider {
  constructor(private readonly apiKey?: string) {}

  async fetch(urls: string[]): Promise<WebFetchProviderResponse> {
    const settled = await Promise.all(urls.map(async (url) => this.fetchViaJina(url)));

    return {
      failures: settled.flatMap((item) => item.failure ?? []),
      results: settled.flatMap((item) => item.result ?? []),
    };
  }

  private async fetchViaJina(url: string): Promise<{
    result?: WebFetchResult;
    failure?: WebFetchFailure;
  }> {
    try {
      const response = await fetch(this.toJinaUrl(url), {
        headers: {
          Accept: "text/plain, text/markdown;q=0.9",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
      });

      if (!response.ok) {
        throw new Error(await getHttpError(response));
      }

      const body = normalizeFetchedContent(await response.text());
      const content = this.extractJinaMarkdown(body);

      if (!content) {
        throw new Error("Jina returned empty content.");
      }

      return {
        result: { content, provider: "jina", url },
      };
    } catch (error) {
      return {
        failure: { message: formatErrorMessage(error), provider: "jina", url },
      };
    }
  }

  private toJinaUrl(url: string): string {
    return `https://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`;
  }

  private extractJinaMarkdown(body: string): string {
    const marker = "Markdown Content:";
    const markerIndex = body.indexOf(marker);

    if (markerIndex === -1) {
      return body;
    }

    return body.slice(markerIndex + marker.length).trim();
  }
}
