import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { Account } from "../types";
import { matchesProbe, pathOf, probeUnknownPath, type ProbeSignature } from "./helpCentre";
import { discoverSitemap } from "./sitemap";
import { fetchWithTimeout } from "./utils";

export interface Tier3Result {
  changelog_url: string | null;
  release_velocity: "high" | "medium" | "low" | "unknown";
  freshness_signal: "fresh" | "stale" | "very_stale" | "unknown";
  freshness_confidence: "high" | "medium" | "low";
  tier3_rationale: string;
}

const FAILED_ANALYSIS: Omit<Tier3Result, "changelog_url"> = {
  release_velocity: "unknown",
  freshness_signal: "unknown",
  freshness_confidence: "low",
  tier3_rationale: "LLM analysis failed — review manually.",
};

const SYSTEM_PROMPT = `You are analysing content extracted from a B2B SaaS company's help centre
and changelog to assess two signals:

1. Release velocity - how frequently the company ships product changes.
   Classify as: high (monthly or more frequent), medium (quarterly),
   low (less than quarterly), or unknown.

2. Content freshness - how recently the help centre articles were updated.
   Classify as: fresh (within 90 days), stale (90-365 days),
   very_stale (over 365 days), or unknown.

Rules:
- Base classifications only on evidence present in the content provided.
- If the content is missing, empty, or too sparse to support a classification,
  use 'unknown'. Do not infer or guess.
- Pay attention to dates on changelog entries and article timestamps.
  If dates are absent, note this explicitly.
- If all changelog dates appear to be the same (bulk migration artifact),
  treat freshness as unknown and explain this in the rationale.

Return a JSON object with exactly these fields:
{
  "release_velocity": "high|medium|low|unknown",
  "freshness_signal": "fresh|stale|very_stale|unknown",
  "confidence": "high|medium|low",
  "rationale": "2-3 sentences explaining the evidence behind each classification and any caveats."
}`;

export async function runTier3(account: Account): Promise<Tier3Result> {
  const sitemap = account.help_centre_url ? await discoverSitemap(account.help_centre_url, account.platform) : null;
  const discovery = await discoverChangelog(account.domain, sitemap?.urls ?? []);
  const changelogUrl = account.changelog_url ?? discovery.url;
  const changelogContent = await extractChangelogContent(changelogUrl);
  const articleSample = await extractArticleSample(
    sitemap?.urls ? sampleUrls(sitemap.urls, account.help_centre_url ?? "", 5) : [],
  );

  const analysis = await analyzeWithHaiku(account.domain, changelogContent, articleSample);

  return {
    changelog_url: changelogUrl,
    ...analysis,
  };
}

// --- Changelog URL discovery -------------------------------------------------

interface ChangelogDiscovery {
  url: string | null;
  method: "sitemap" | "path" | "embed" | null;
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

const CHANGELOG_SITEMAP_KEYWORDS = ["changelog", "releasenotes", "whatsnew", "productupdates"];

const CHANGELOG_TOOL_SIGNATURES = [
  /beamer\.io/i,
  /headwayapp\.co/i,
  /canny\.io/i,
  /launchnotes\.io/i,
  /announcekit\.app/i,
];

async function checkChangelogPath(url: string, probe: ProbeSignature | null): Promise<string | null> {
  const res = await fetchWithTimeout(url, { method: "HEAD" });
  if (!res || !res.ok) return null;

  const finalUrl = res.url || url;
  const finalPath = pathOf(finalUrl);
  if (finalPath === "" || finalPath === "/") return null;
  if (matchesProbe(res, probe)) return null;

  return finalUrl;
}

function normalizePath(path: string): string {
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // leave malformed paths as-is
  }
  return decoded.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findChangelogInSitemap(urls: string[]): string | null {
  for (const keyword of CHANGELOG_SITEMAP_KEYWORDS) {
    const match = urls.find((url) => normalizePath(pathOf(url)).includes(keyword));
    if (match) return match;
  }
  return null;
}

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

async function discoverChangelog(domain: string | null, helpCentreSitemapUrls: string[]): Promise<ChangelogDiscovery> {
  const sitemapMatch = findChangelogInSitemap(helpCentreSitemapUrls);
  if (sitemapMatch) return { url: sitemapMatch, method: "sitemap" };

  if (!domain) return NO_CHANGELOG;

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

  return NO_CHANGELOG;
}

// --- Content extraction ------------------------------------------------------

const DATE_LABEL_REGEX =
  /\b(?:last\s+updated|last\s+modified|updated|reviewed\s+on|reviewed|published)\s*:?\s*.{0,80}/gi;

function cleanReadableText($: CheerioAPI): string {
  $("script, style, noscript, template, svg, nav, header, footer, aside, form").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

function truncateWords(text: string, limit: number): string {
  const parts = words(text);
  if (parts.length <= limit) return text;
  return parts.slice(0, limit).join(" ");
}

async function extractChangelogContent(changelogUrl: string | null): Promise<string> {
  if (!changelogUrl) return "";

  const res = await fetchWithTimeout(changelogUrl);
  if (!res || !res.ok) return "";

  const $ = cheerio.load(await res.text());
  return truncateWords(cleanReadableText($), 1_500);
}

function sampleUrls(urls: string[], exclude: string, count: number): string[] {
  const filtered = urls.filter((u) => u !== exclude);
  if (filtered.length <= count) return filtered;

  const step = filtered.length / count;
  const sample: string[] = [];
  for (let i = 0; i < count; i++) sample.push(filtered[Math.floor(i * step)]);
  return sample;
}

function extractDateLabels(text: string): string[] {
  return [...text.matchAll(DATE_LABEL_REGEX)]
    .map((match) => match[0].trim())
    .filter(Boolean)
    .slice(0, 5);
}

async function extractArticleExcerpt(url: string): Promise<string | null> {
  const res = await fetchWithTimeout(url);
  if (!res || !res.ok) return null;

  const $ = cheerio.load(await res.text());
  const title = $("title").first().text().replace(/\s+/g, " ").trim();
  const text = cleanReadableText($);
  const dateLabels = extractDateLabels(text);
  const body = truncateWords(text, 150);

  const lines = [`URL: ${url}`];
  if (title) lines.push(`Title: ${title}`);
  if (dateLabels.length > 0) lines.push(`Visible date labels: ${dateLabels.join(" | ")}`);
  if (body) lines.push(`Excerpt: ${body}`);

  return lines.join("\n");
}

async function extractArticleSample(urls: string[]): Promise<string> {
  const excerpts: string[] = [];
  for (const url of urls.slice(0, 5)) {
    const excerpt = await extractArticleExcerpt(url);
    if (excerpt) excerpts.push(excerpt);
  }
  return truncateWords(excerpts.join("\n\n"), 1_000);
}

// --- LLM analysis ------------------------------------------------------------

interface HaikuAnalysis {
  release_velocity: "high" | "medium" | "low" | "unknown";
  freshness_signal: "fresh" | "stale" | "very_stale" | "unknown";
  freshness_confidence: "high" | "medium" | "low";
  tier3_rationale: string;
}

const RELEASE_VELOCITIES = new Set(["high", "medium", "low", "unknown"]);
const FRESHNESS_SIGNALS = new Set(["fresh", "stale", "very_stale", "unknown"]);
const CONFIDENCE_VALUES = new Set(["high", "medium", "low"]);

function buildUserPrompt(domain: string | null, changelogContent: string, articleSample: string): string {
  return `Company domain: ${domain ?? "unknown"}

CHANGELOG CONTENT:
${changelogContent || "No changelog URL found or content could not be retrieved."}

ARTICLE SAMPLE (up to 5 articles):
${articleSample || "No articles could be retrieved."}`;
}

function parseAnalysisJson(text: string): HaikuAnalysis {
  const parsed = JSON.parse(text) as Record<string, unknown>;

  if (
    typeof parsed.release_velocity !== "string" ||
    !RELEASE_VELOCITIES.has(parsed.release_velocity) ||
    typeof parsed.freshness_signal !== "string" ||
    !FRESHNESS_SIGNALS.has(parsed.freshness_signal) ||
    typeof parsed.confidence !== "string" ||
    !CONFIDENCE_VALUES.has(parsed.confidence) ||
    typeof parsed.rationale !== "string" ||
    parsed.rationale.trim().length === 0
  ) {
    throw new Error("Invalid Tier 3 analysis JSON");
  }

  return {
    release_velocity: parsed.release_velocity as HaikuAnalysis["release_velocity"],
    freshness_signal: parsed.freshness_signal as HaikuAnalysis["freshness_signal"],
    freshness_confidence: parsed.confidence as HaikuAnalysis["freshness_confidence"],
    tier3_rationale: parsed.rationale.trim(),
  };
}

async function callHaiku(userPrompt: string): Promise<HaikuAnalysis> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic request failed: ${res.status}`);

  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = data.content?.find((part) => part.type === "text")?.text;
  if (!text) throw new Error("Anthropic response did not include text");

  return parseAnalysisJson(text);
}

async function analyzeWithHaiku(
  domain: string | null,
  changelogContent: string,
  articleSample: string,
): Promise<Omit<Tier3Result, "changelog_url">> {
  const userPrompt = buildUserPrompt(domain, changelogContent, articleSample);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await callHaiku(userPrompt);
    } catch {
      // Retry once for malformed JSON or transient API failures.
    }
  }

  return FAILED_ANALYSIS;
}
