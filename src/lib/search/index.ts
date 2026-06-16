import type { SearchProvider } from "./types";
import { BraveSearchProvider } from "./brave";

export type { SearchResult, SearchProvider } from "./types";

let instance: SearchProvider | null = null;

export function getSearchProvider(): SearchProvider {
  if (instance) return instance;
  const provider = process.env.SEARCH_PROVIDER ?? "brave";
  if (provider === "brave") {
    instance = new BraveSearchProvider();
    return instance;
  }
  throw new Error(`Unknown SEARCH_PROVIDER: "${provider}". Supported values: brave`);
}
