export interface SearchResult {
  url: string;
  title: string;
  description: string;
}

export interface SearchProvider {
  search(query: string, count?: number): Promise<SearchResult[]>;
}
