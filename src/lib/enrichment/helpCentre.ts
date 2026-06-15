import * as cheerio from "cheerio";
import { fetchWithTimeout, hostOf } from "./utils";

export interface HelpCentreResult {
  url: string | null;
  status: "found" | "not_found";
}

/** Checked in order; help-site subdomains aimed at non-technical end users rank ahead of developer-facing docs. */
const SUBDOMAIN_PREFIXES = ["help", "support", "knowledge", "docs", "kb"];
const PATH_CANDIDATES = ["/hc", "/help", "/support", "/docs", "/knowledge-base"];
const NAV_KEYWORDS = ["help", "support", "docs", "knowledge", "hc"];

export function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

export interface ProbeSignature {
  status: number;
  etag: string | null;
  length: string | null;
}

/**
 * Fetches a path that almost certainly doesn't exist, to fingerprint how the
 * server responds to unknown routes. Single-page-app servers often return a
 * 200 with the same shell HTML for any path (client-side routing), which
 * makes "200 OK" useless as a signal that a candidate path is real.
 */
export async function probeUnknownPath(rootDomain: string): Promise<ProbeSignature | null> {
  const probePath = `/fieldwork-probe-${Math.random().toString(36).slice(2, 10)}`;
  const res = await fetchWithTimeout(`https://${rootDomain}${probePath}`, { method: "HEAD" });
  if (!res) return null;

  return {
    status: res.status,
    etag: res.headers.get("etag"),
    length: res.headers.get("content-length"),
  };
}

/** True if `res` looks like the same catch-all response as the unknown-path probe. */
export function matchesProbe(res: Response, probe: ProbeSignature | null): boolean {
  if (!probe || res.status !== probe.status) return false;
  if (probe.etag && res.headers.get("etag") === probe.etag) return true;
  if (probe.length && res.headers.get("content-length") === probe.length) return true;
  return false;
}

/**
 * A candidate resolves only if it returns 2xx, doesn't redirect back to the
 * bare root domain's homepage (the usual signal of a catch-all/404 page),
 * doesn't land on a www subdomain (help centres rarely live there, and a
 * redirect to www is usually just a bounce back to the marketing site), and
 * isn't indistinguishable from the root domain's response to an unknown path
 * (the usual signal of an SPA catch-all route).
 */
async function checkCandidate(url: string, rootDomain: string, probe: ProbeSignature | null): Promise<string | null> {
  const res = await fetchWithTimeout(url, { method: "HEAD" });
  if (!res || !res.ok) return null;

  const finalUrl = res.url || url;
  const finalHost = hostOf(finalUrl);
  const finalPath = pathOf(finalUrl);

  if (finalHost.startsWith("www.")) return null;

  const isRootPath = finalPath === "" || finalPath === "/";
  if (finalHost === rootDomain && isRootPath) return null;
  if (finalHost === rootDomain && matchesProbe(res, probe)) return null;

  return finalUrl;
}

export async function discoverHelpCentre(domain: string): Promise<HelpCentreResult> {
  const rootDomain = domain.replace(/^www\./i, "").toLowerCase();
  const probe = await probeUnknownPath(rootDomain);

  // Step 1: common subdomains
  for (const prefix of SUBDOMAIN_PREFIXES) {
    const found = await checkCandidate(`https://${prefix}.${rootDomain}`, rootDomain, probe);
    if (found) return { url: found, status: "found" };
  }

  // Step 2: common paths
  for (const path of PATH_CANDIDATES) {
    const found = await checkCandidate(`https://${rootDomain}${path}`, rootDomain, probe);
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
          const found = await checkCandidate(base, rootDomain, probe);
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
      const found = await checkCandidate(candidate, rootDomain, probe);
      if (found) return { url: found, status: "found" };
    }
  }

  return { url: null, status: "not_found" };
}
