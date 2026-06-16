import type { SearchProvider, SearchResult } from "./types";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Module-level timestamp so back-to-back calls within a single request respect the rate limit.
let lastCallMs = 0;

async function throttle(): Promise<void> {
  const delay = Number(process.env.CHANGELOG_SEARCH_DELAY_MS ?? 1100);
  const elapsed = Date.now() - lastCallMs;
  if (elapsed < delay) await sleep(delay - elapsed);
  lastCallMs = Date.now();
}

interface BraveWebResult {
  url?: string;
  title?: string;
  description?: string;
}

interface BraveResponse {
  web?: { results?: BraveWebResult[] };
}

export class BraveSearchProvider implements SearchProvider {
  async search(query: string, count = 10): Promise<SearchResult[]> {
    const apiKey = process.env.BRAVE_SEARCH_API_KEY;
    if (!apiKey) {
      console.error("BRAVE_SEARCH_API_KEY is not set — skipping search");
      return [];
    }

    await throttle();

    try {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", query);
      url.searchParams.set("count", String(count));

      const res = await fetch(url.toString(), {
        headers: {
          "X-Subscription-Token": apiKey,
          Accept: "application/json",
        },
      });

      if (!res.ok) {
        console.error("Brave search failed", { status: res.status, query });
        return [];
      }

      const data = (await res.json()) as BraveResponse;
      return (data.web?.results ?? []).flatMap((r) => {
        if (!r.url) return [];
        return [{ url: r.url, title: r.title ?? "", description: r.description ?? "" }];
      });
    } catch (error) {
      console.error("Brave search error", { query, error });
      return [];
    }
  }
}
