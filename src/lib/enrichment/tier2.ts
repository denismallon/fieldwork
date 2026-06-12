import type { Account } from "../types";
import { buildLanguageBreakdown, discoverSitemap } from "./sitemap";

export interface Tier2Result {
  raw_page_count: number | null;
  primary_page_count: number | null;
  page_count_status: "found" | "not_found";
  detected_languages: string | null;
}

const NOT_FOUND: Tier2Result = {
  raw_page_count: null,
  primary_page_count: null,
  page_count_status: "not_found",
  detected_languages: null,
};

export async function runTier2(account: Account): Promise<Tier2Result> {
  if (!account.help_centre_url) return NOT_FOUND;

  const sitemap = await discoverSitemap(account.help_centre_url, account.platform);
  if (sitemap.status === "not_found" || sitemap.urls.length === 0) return NOT_FOUND;

  let tier1Languages: string[] = [];
  if (account.detected_languages) {
    try {
      const parsed = JSON.parse(account.detected_languages);
      if (Array.isArray(parsed)) tier1Languages = parsed;
    } catch {
      // ignore malformed JSON
    }
  }

  const breakdown = buildLanguageBreakdown(sitemap.urls, tier1Languages);

  return {
    raw_page_count: sitemap.urls.length,
    primary_page_count: Math.max(...Object.values(breakdown)),
    page_count_status: "found",
    detected_languages: JSON.stringify(breakdown),
  };
}
