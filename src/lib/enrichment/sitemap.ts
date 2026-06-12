import * as cheerio from "cheerio";
import { fetchWithTimeout } from "./utils";

export interface SitemapResult {
  urls: string[];
  status: "found" | "not_found";
}

interface ParsedSitemap {
  urls: string[];
  isIndex: boolean;
}

async function fetchSitemap(url: string): Promise<ParsedSitemap | null> {
  const res = await fetchWithTimeout(url);
  if (!res || !res.ok) return null;

  const text = await res.text();
  if (!text.includes("<urlset") && !text.includes("<sitemapindex")) return null;

  const $ = cheerio.load(text, { xmlMode: true });
  const isIndex = $("sitemapindex").length > 0;
  const urls = $("loc")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);

  return { urls, isIndex };
}

export async function discoverSitemap(helpCentreUrl: string, platform: string | null): Promise<SitemapResult> {
  const origin = new URL(helpCentreUrl).origin;
  const candidates: string[] = [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];

  const robotsRes = await fetchWithTimeout(`${origin}/robots.txt`);
  if (robotsRes && robotsRes.ok) {
    const text = await robotsRes.text();
    const match = text.match(/^\s*Sitemap:\s*(\S+)/im);
    if (match) candidates.push(match[1]);
  }

  if (platform === "Zendesk") candidates.push(`${origin}/hc/sitemap.xml`);
  if (platform === "Intercom") candidates.push(`${origin}/sitemap.xml`);

  for (const candidate of candidates) {
    const sitemap = await fetchSitemap(candidate);
    if (!sitemap) continue;

    if (sitemap.isIndex) {
      const allUrls: string[] = [];
      for (const childUrl of sitemap.urls) {
        const child = await fetchSitemap(childUrl);
        if (child) allUrls.push(...child.urls);
      }
      if (allUrls.length > 0) return { urls: allUrls, status: "found" };
      continue;
    }

    if (sitemap.urls.length > 0) return { urls: sitemap.urls, status: "found" };
  }

  return { urls: [], status: "not_found" };
}

/**
 * Groups sitemap URLs by two-letter language prefix, restricted to the
 * language codes Tier 1 already detected. Everything else (and the whole
 * set, for monolingual sites) lands under "default".
 */
export function buildLanguageBreakdown(urls: string[], detectedLanguages: string[]): Record<string, number> {
  if (detectedLanguages.length === 0) {
    return { default: urls.length };
  }

  const regex = new RegExp(`^/(${detectedLanguages.join("|")})(/|$)`, "i");
  const breakdown: Record<string, number> = {};

  for (const url of urls) {
    let key = "default";
    try {
      const pathname = new URL(url).pathname;
      const match = pathname.match(regex);
      if (match) key = match[1].toLowerCase();
    } catch {
      // ignore invalid URL, falls into "default"
    }
    breakdown[key] = (breakdown[key] || 0) + 1;
  }

  return breakdown;
}
