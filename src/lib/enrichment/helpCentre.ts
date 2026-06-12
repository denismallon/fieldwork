import * as cheerio from "cheerio";
import { fetchWithTimeout, hostOf } from "./utils";

export interface HelpCentreResult {
  url: string | null;
  status: "found" | "not_found";
}

const SUBDOMAIN_PREFIXES = ["help", "support", "docs", "kb"];
const PATH_CANDIDATES = ["/hc", "/help", "/support", "/docs", "/knowledge-base"];
const NAV_KEYWORDS = ["help", "support", "docs", "knowledge", "hc"];

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

/**
 * A candidate resolves only if it returns 2xx and doesn't redirect back to
 * the bare root domain's homepage (the usual signal of a catch-all/404 page).
 */
async function checkCandidate(url: string, rootDomain: string): Promise<string | null> {
  const res = await fetchWithTimeout(url, { method: "HEAD" });
  if (!res || !res.ok) return null;

  const finalUrl = res.url || url;
  const finalHost = hostOf(finalUrl);
  const finalPath = pathOf(finalUrl);
  const isRootHost = finalHost === rootDomain || finalHost === `www.${rootDomain}`;
  const isRootPath = finalPath === "" || finalPath === "/";

  if (isRootHost && isRootPath) return null;

  return finalUrl;
}

export async function discoverHelpCentre(domain: string): Promise<HelpCentreResult> {
  const rootDomain = domain.replace(/^www\./i, "").toLowerCase();

  // Step 1: common subdomains
  for (const prefix of SUBDOMAIN_PREFIXES) {
    const found = await checkCandidate(`https://${prefix}.${rootDomain}`, rootDomain);
    if (found) return { url: found, status: "found" };
  }

  // Step 2: common paths
  for (const path of PATH_CANDIDATES) {
    const found = await checkCandidate(`https://${rootDomain}${path}`, rootDomain);
    if (found) return { url: found, status: "found" };
  }

  // Step 3: robots.txt Sitemap directive
  const robotsRes = await fetchWithTimeout(`https://${rootDomain}/robots.txt`);
  if (robotsRes && robotsRes.ok) {
    const text = await robotsRes.text();
    const match = text.match(/^\s*Sitemap:\s*(\S+)/im);
    if (match) {
      try {
        const sitemapUrl = new URL(match[1]);
        const base = `${sitemapUrl.protocol}//${sitemapUrl.host}`;
        const baseHost = hostOf(base);
        if (baseHost !== rootDomain && baseHost !== `www.${rootDomain}`) {
          const found = await checkCandidate(base, rootDomain);
          if (found) return { url: found, status: "found" };
        }
      } catch {
        // ignore invalid Sitemap directive
      }
    }
  }

  // Step 4: homepage nav links
  const homeRes = await fetchWithTimeout(`https://${rootDomain}/`);
  if (homeRes && homeRes.ok) {
    const html = await homeRes.text();
    const base = homeRes.url || `https://${rootDomain}/`;
    const $ = cheerio.load(html);

    const candidates: string[] = [];
    $("nav a").each((_, el) => {
      const href = $(el).attr("href") || "";
      const text = $(el).text().toLowerCase();
      const hrefLower = href.toLowerCase();
      if (!NAV_KEYWORDS.some((kw) => hrefLower.includes(kw) || text.includes(kw))) return;
      try {
        candidates.push(new URL(href, base).toString());
      } catch {
        // ignore invalid href
      }
    });

    for (const candidate of candidates) {
      const found = await checkCandidate(candidate, rootDomain);
      if (found) return { url: found, status: "found" };
    }
  }

  return { url: null, status: "not_found" };
}
