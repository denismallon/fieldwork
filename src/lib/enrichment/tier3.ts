import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { Account } from "../types";
import { matchesProbe, pathOf, probeUnknownPath, type ProbeSignature } from "./helpCentre";
import { discoverSitemap } from "./sitemap";
import { fetchWithTimeout } from "./utils";

export interface Tier3Result {
  changelog_url: string | null;
  release_velocity: "high" | "medium" | "low" | "unknown";
  release_velocity_source: "dedicated_tool" | "rss" | "blog" | "unknown";
  freshness_signal: "fresh" | "stale" | "very_stale" | "unknown";
  freshness_confidence: "high" | "medium" | "low" | "unmeasurable";
  freshness_source: "in_content" | "sitemap_lastmod" | "http_header" | "unknown";
}

export async function runTier3(account: Account): Promise<Tier3Result> {
  const discovery = account.domain ? await discoverChangelog(account.domain) : NO_CHANGELOG;
  const velocity = await classifyReleaseVelocity(discovery);
  const freshness = await classifyFreshness(account);

  return {
    changelog_url: discovery.url,
    ...velocity,
    ...freshness,
  };
}

// --- Shared date helpers -----------------------------------------------------

const MONTH_NAMES: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

const MONTH_NAME_PATTERN =
  "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec";

const ISO_DATE_REGEX = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const MONTH_DAY_YEAR_REGEX = new RegExp(`\\b(${MONTH_NAME_PATTERN})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, "gi");
const MONTH_YEAR_REGEX = new RegExp(`\\b(${MONTH_NAME_PATTERN})\\s+(\\d{4})\\b`, "gi");

/** Extracts ISO and natural-language date-like strings (e.g. "January 2025", "Jan 15, 2025") from text. */
function extractDates(text: string): Date[] {
  const dates: Date[] = [];

  for (const m of text.matchAll(ISO_DATE_REGEX)) {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) dates.push(d);
  }
  for (const m of text.matchAll(MONTH_DAY_YEAR_REGEX)) {
    const month = MONTH_NAMES[m[1].toLowerCase()];
    if (month === undefined) continue;
    const d = new Date(Date.UTC(Number(m[3]), month, Number(m[2])));
    if (!Number.isNaN(d.getTime())) dates.push(d);
  }
  for (const m of text.matchAll(MONTH_YEAR_REGEX)) {
    const month = MONTH_NAMES[m[1].toLowerCase()];
    if (month === undefined) continue;
    const d = new Date(Date.UTC(Number(m[2]), month, 1));
    if (!Number.isNaN(d.getTime())) dates.push(d);
  }

  return dates;
}

function daysAgo(date: Date): number {
  return (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function classifyVelocityFromDate(mostRecent: Date): "high" | "medium" | "low" {
  const days = daysAgo(mostRecent);
  if (days <= 30) return "high";
  if (days <= 90) return "medium";
  return "low";
}

function classifyFreshnessFromAge(medianDays: number): "fresh" | "stale" | "very_stale" {
  if (medianDays < 90) return "fresh";
  if (medianDays <= 365) return "stale";
  return "very_stale";
}

// --- Step A: changelog URL discovery -----------------------------------------

interface ChangelogDiscovery {
  url: string | null;
  method: "path" | "embed" | "rss" | null;
}

const NO_CHANGELOG: ChangelogDiscovery = { url: null, method: null };

const CHANGELOG_PATHS = [
  "/changelog",
  "/releases",
  "/whats-new",
  "/updates",
  "/release-notes",
  "/product-updates",
  "/new",
];

const FEED_PATHS = ["/feed", "/rss", "/atom", "/feed.xml", "/changelog.xml", "/releases.rss"];

const CHANGELOG_TOOL_SIGNATURES = [
  /beamer\.io/i,
  /headwayapp\.co/i,
  /canny\.io/i,
  /launchnotes\.io/i,
  /announcekit\.app/i,
];

/** A path resolves only if it doesn't redirect back to the homepage and isn't an SPA catch-all (see helpCentre.ts). */
async function checkChangelogPath(url: string, probe: ProbeSignature | null): Promise<string | null> {
  const res = await fetchWithTimeout(url, { method: "HEAD" });
  if (!res || !res.ok) return null;

  const finalUrl = res.url || url;
  const finalPath = pathOf(finalUrl);
  if (finalPath === "" || finalPath === "/") return null;
  if (matchesProbe(res, probe)) return null;

  return finalUrl;
}

async function checkFeedPath(url: string, probe: ProbeSignature | null): Promise<string | null> {
  const res = await fetchWithTimeout(url);
  if (!res || !res.ok) return null;
  if (matchesProbe(res, probe)) return null;

  const text = await res.text();
  if (text.includes("<rss") || text.includes("<feed")) return res.url || url;

  return null;
}

/** Script/iframe src attributes on the homepage, used to detect embedded changelog tool widgets. */
function embedSources(html: string): string {
  const $ = cheerio.load(html);
  const sources: string[] = [];
  $("script[src]").each((_, el) => {
    const src = $(el).attr("src");
    if (src) sources.push(src);
  });
  $("iframe[src]").each((_, el) => {
    const src = $(el).attr("src");
    if (src) sources.push(src);
  });
  return sources.join(" ").toLowerCase();
}

async function discoverChangelog(domain: string): Promise<ChangelogDiscovery> {
  const rootDomain = domain.replace(/^www\./i, "").toLowerCase();
  const origin = `https://${rootDomain}`;
  const probe = await probeUnknownPath(rootDomain);

  for (const path of CHANGELOG_PATHS) {
    const found = await checkChangelogPath(`${origin}${path}`, probe);
    if (found) return { url: found, method: "path" };
  }

  const homeRes = await fetchWithTimeout(`${origin}/`);
  if (homeRes && homeRes.ok) {
    const html = await homeRes.text();
    const haystack = embedSources(html);
    if (CHANGELOG_TOOL_SIGNATURES.some((sig) => sig.test(haystack))) {
      return { url: homeRes.url || `${origin}/`, method: "embed" };
    }
  }

  for (const path of FEED_PATHS) {
    const found = await checkFeedPath(`${origin}${path}`, probe);
    if (found) return { url: found, method: "rss" };
  }

  return NO_CHANGELOG;
}

// --- Step B: release velocity classification ----------------------------------

interface VelocityResult {
  release_velocity: "high" | "medium" | "low" | "unknown";
  release_velocity_source: "dedicated_tool" | "rss" | "blog" | "unknown";
}

const UNKNOWN_VELOCITY: VelocityResult = { release_velocity: "unknown", release_velocity_source: "unknown" };

function extractFeedDates(xml: string): Date[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  const dates: Date[] = [];
  $("pubDate, published, updated").each((_, el) => {
    const d = new Date($(el).text().trim());
    if (!Number.isNaN(d.getTime())) dates.push(d);
  });
  return dates;
}

async function classifyReleaseVelocity(discovery: ChangelogDiscovery): Promise<VelocityResult> {
  if (!discovery.url || !discovery.method) return UNKNOWN_VELOCITY;

  const res = await fetchWithTimeout(discovery.url);
  if (!res || !res.ok) return UNKNOWN_VELOCITY;

  if (discovery.method === "rss") {
    const dates = extractFeedDates(await res.text());
    if (dates.length === 0) return UNKNOWN_VELOCITY;
    const mostRecent = new Date(Math.max(...dates.map((d) => d.getTime())));
    return { release_velocity: classifyVelocityFromDate(mostRecent), release_velocity_source: "rss" };
  }

  const html = await res.text();
  const text = cheerio.load(html)("body").text();
  const dates = extractDates(text);
  if (dates.length === 0) return UNKNOWN_VELOCITY;

  const mostRecent = new Date(Math.max(...dates.map((d) => d.getTime())));
  const source = discovery.method === "embed" ? "dedicated_tool" : "blog";
  return { release_velocity: classifyVelocityFromDate(mostRecent), release_velocity_source: source };
}

// --- Step C: freshness signal --------------------------------------------------

interface FreshnessResult {
  freshness_signal: "fresh" | "stale" | "very_stale" | "unknown";
  freshness_confidence: "high" | "medium" | "low" | "unmeasurable";
  freshness_source: "in_content" | "sitemap_lastmod" | "http_header" | "unknown";
}

const UNMEASURABLE_FRESHNESS: FreshnessResult = {
  freshness_signal: "unknown",
  freshness_confidence: "unmeasurable",
  freshness_source: "unknown",
};

const FRESHNESS_LABEL_REGEX = /\b(?:last\s+updated|last\s+modified|updated|reviewed\s+on|published)\s*:?\s*(.{0,40})/gi;

/** Evenly samples up to `count` URLs across the list for a representative date spread. */
function sampleUrls(urls: string[], exclude: string, count: number): string[] {
  const filtered = urls.filter((u) => u !== exclude);
  if (filtered.length <= count) return filtered;

  const step = filtered.length / count;
  const sample: string[] = [];
  for (let i = 0; i < count; i++) sample.push(filtered[Math.floor(i * step)]);
  return sample;
}

/** Reads article:modified_time, JSON-LD dateModified, or "Last updated"-style labels. */
function extractInContentDate($: CheerioAPI): Date | null {
  const metaContent = $('meta[property="article:modified_time"]').attr("content");
  if (metaContent) {
    const d = new Date(metaContent);
    if (!Number.isNaN(d.getTime())) return d;
  }

  let jsonLdDate: Date | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (jsonLdDate) return;
    try {
      const data = JSON.parse($(el).text());
      for (const item of Array.isArray(data) ? data : [data]) {
        if (item && typeof item.dateModified === "string") {
          const d = new Date(item.dateModified);
          if (!Number.isNaN(d.getTime())) {
            jsonLdDate = d;
            break;
          }
        }
      }
    } catch {
      // ignore malformed JSON-LD
    }
  });
  if (jsonLdDate) return jsonLdDate;

  const bodyText = $("body").text();
  for (const m of bodyText.matchAll(FRESHNESS_LABEL_REGEX)) {
    const dates = extractDates(m[1]);
    if (dates.length > 0) return dates[0];
  }

  return null;
}

/** Method 1 (highest reliability): in-page "Last updated"/meta/JSON-LD dates across sampled articles. */
async function tryInContentFreshness(urls: string[]): Promise<FreshnessResult | null> {
  const ages: number[] = [];

  for (const url of urls) {
    const res = await fetchWithTimeout(url);
    if (!res || !res.ok) continue;
    const $ = cheerio.load(await res.text());
    const date = extractInContentDate($);
    if (date) ages.push(daysAgo(date));
  }

  if (ages.length >= 5) {
    return { freshness_signal: classifyFreshnessFromAge(median(ages)), freshness_confidence: "high", freshness_source: "in_content" };
  }
  if (ages.length >= 2) {
    return { freshness_signal: classifyFreshnessFromAge(median(ages)), freshness_confidence: "medium", freshness_source: "in_content" };
  }
  return null;
}

const MIGRATION_ARTIFACT_THRESHOLD = 0.85;

/** Method 2 (medium reliability): sitemap <lastmod> values, guarded against bulk-import artifacts. */
function tryLastmodFreshness(lastmods: Record<string, string>): FreshnessResult | null {
  const values = Object.values(lastmods);
  if (values.length === 0) return null;

  const dateOnly = values.map((v) => v.slice(0, 10));
  const counts = new Map<string, number>();
  for (const d of dateOnly) counts.set(d, (counts.get(d) ?? 0) + 1);
  const maxShare = Math.max(...counts.values()) / dateOnly.length;
  if (maxShare >= MIGRATION_ARTIFACT_THRESHOLD) {
    return { freshness_signal: "unknown", freshness_confidence: "unmeasurable", freshness_source: "sitemap_lastmod" };
  }

  const ages = values.map((v) => daysAgo(new Date(v))).filter((d) => !Number.isNaN(d));
  if (ages.length === 0) return null;

  return { freshness_signal: classifyFreshnessFromAge(median(ages)), freshness_confidence: "medium", freshness_source: "sitemap_lastmod" };
}

/** Method 3 (lowest reliability): HTTP Last-Modified headers on sampled articles. */
async function tryHttpHeaderFreshness(urls: string[]): Promise<FreshnessResult | null> {
  const ages: number[] = [];

  for (const url of urls) {
    const res = await fetchWithTimeout(url, { method: "HEAD" });
    if (!res) continue;
    const lastModified = res.headers.get("last-modified");
    if (!lastModified) continue;
    const d = new Date(lastModified);
    if (!Number.isNaN(d.getTime())) ages.push(daysAgo(d));
  }

  if (ages.length === 0) return null;

  return { freshness_signal: classifyFreshnessFromAge(median(ages)), freshness_confidence: "low", freshness_source: "http_header" };
}

async function classifyFreshness(account: Account): Promise<FreshnessResult> {
  if (!account.help_centre_url) return UNMEASURABLE_FRESHNESS;

  const sitemap = await discoverSitemap(account.help_centre_url, account.platform);
  const sample = sampleUrls(sitemap.urls, account.help_centre_url, 10);

  const method1 = await tryInContentFreshness(sample);
  if (method1) return method1;

  if (sitemap.status === "found") {
    const method2 = tryLastmodFreshness(sitemap.lastmods);
    if (method2) return method2;
  }

  const method3 = await tryHttpHeaderFreshness(sample.slice(0, 5));
  if (method3) return method3;

  return UNMEASURABLE_FRESHNESS;
}
