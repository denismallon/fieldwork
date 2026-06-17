import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { getDomain } from "tldts";
import type { Account } from "../types";
import { getSearchProvider } from "../search";
import { discoverSitemap } from "./sitemap";
import { fetchWithTimeout } from "./utils";

export interface Tier3Result {
  changelog_url: string | null;
  changelog_type: "release_index" | "news_blog" | "single_post" | "not_a_changelog" | "none" | null;
  changelog_candidates: string | null;
  release_velocity: "high" | "medium" | "low" | "unknown" | null;
  freshness_signal: "fresh" | "stale" | "very_stale" | "unknown" | null;
  freshness_confidence: "high" | "medium" | "low" | null;
  tier3_rationale: string | null;
}

/** changelog_candidates is owned by the discovery step, not the LLM analysis. */
type LlmAnalysis = Omit<Tier3Result, "changelog_url" | "changelog_candidates">;

const FAILED_ANALYSIS: LlmAnalysis = {
  changelog_type: "none",
  release_velocity: "unknown",
  freshness_signal: "unknown",
  freshness_confidence: "low",
  tier3_rationale: "LLM analysis failed — review manually.",
};

const SYSTEM_PROMPT = `You are analysing content extracted from a B2B SaaS company's help centre and changelog to assess two signals: release velocity and content freshness.

You will be given today's date. All recency judgements must be made relative to that date.

## Release velocity

First, classify what kind of page the changelog content actually is:
- release_index: a structured list/index of product release notes or version history
- news_blog: a blog or news category with company or product news, not a structured release log
- single_post: an individual release note or announcement, not the full index
- not_a_changelog: the content is not about product releases at all
- none: no changelog content was provided

Only assess velocity from a 'release_index'. For any other type, set release_velocity to 'unknown' — you cannot measure shipping cadence from a single post, a news blog, or an unrelated page.

When you do have a release_index:
1. Identify the SINGLE MOST RECENT entry date.
2. Compute how long ago that was relative to today's date, in months.
3. Classify velocity from RECENCY, not from how many entries you see. A page showing ten releases all from two years ago is LOW or unknown velocity, not high.
   - most recent entry within ~1 month → high
   - most recent entry within ~3 months → medium
   - most recent entry older than ~3 months → low
   - no dates extractable → unknown

## Content freshness

Classify how recently the help centre articles were updated, relative to today's date:
- fresh: most content updated within 90 days
- stale: 90–365 days
- very_stale: over 365 days
- unknown: insufficient evidence

Two specific signals to weigh:
- If release notes or articles contain crosslinks to other help articles or product pages (e.g. "read more about our new integration here"), this is a positive sign of an actively maintained help centre. Weigh it against a 'stale' classification.
- If all article or changelog dates appear identical (a bulk migration artifact), treat freshness as 'unknown' and say so in the rationale.

## Rules
- Base every classification only on evidence present in the provided content. Never infer or guess.
- Use 'unknown' freely when content is missing, sparse, or the wrong type.
- Always reason from today's date for any recency judgement.

Return a JSON object with exactly these fields:
{
  "changelog_type": "release_index|news_blog|single_post|not_a_changelog|none",
  "release_velocity": "high|medium|low|unknown",
  "freshness_signal": "fresh|stale|very_stale|unknown",
  "confidence": "high|medium|low",
  "rationale": "2-3 sentences. State the most recent changelog date you found and how many months ago that is, the basis for the freshness call including any crosslink or migration-artifact observations, and any caveats."
}`;

export async function runTier3(account: Account): Promise<Tier3Result> {
  // Gate: only rows with a found help centre that passed Pass 1
  if (account.help_centre_url_status !== "found" || account.pass1 !== 1) {
    return {
      changelog_url: null,
      changelog_type: null,
      changelog_candidates: null,
      release_velocity: null,
      freshness_signal: null,
      freshness_confidence: null,
      tier3_rationale: null,
    };
  }

  const sitemap = account.help_centre_url
    ? await discoverSitemap(account.help_centre_url, account.platform)
    : null;

  const discovery = await discoverChangelog(account.domain, account.company_name, account.help_centre_url);
  const changelogUrl = discovery.url;

  if (!changelogUrl) {
    return {
      changelog_url: null,
      changelog_candidates: discovery.candidatesJson,
      changelog_type: "none",
      release_velocity: null,
      freshness_signal: null,
      freshness_confidence: null,
      tier3_rationale: "No structured changelog found — release and freshness not assessed.",
    };
  }

  const changelogContent = await extractChangelogContent(changelogUrl);
  const articleSample = await extractArticleSample(
    sitemap?.urls ? sampleUrls(sitemap.urls, account.help_centre_url ?? "", 5) : [],
  );

  const raw = await analyzeWithHaiku(account.domain, changelogContent, articleSample);
  // Coupling restored: non-release-index → null all three signals
  const analysis =
    raw.changelog_type !== "release_index"
      ? { ...raw, release_velocity: null, freshness_signal: null, freshness_confidence: null }
      : raw;

  return {
    changelog_url: changelogUrl,
    changelog_candidates: discovery.candidatesJson,
    ...analysis,
  };
}

// --- Changelog URL discovery (search-backed) ---------------------------------

interface ScoredCandidate {
  url: string;
  score: number;
  source: "search";
}

interface DiscoveryResult {
  url: string | null;
  candidatesJson: string | null;
}

const SCORE_PATH_TERMS = ["changelog", "release-notes", "releases", "whats-new", "whatsnew"];
const HELP_SUBDOMAIN_RE = /^(?:help|support|docs|developer|dev|kb)\./i;
const MARKETING_PATH_RE =
  /\/(?:blog|news|press|press-releases|resources|company-news|careers|courses|policies|wp-content|what-we-do|case-studies)(?:\/|$)/i;
const DATED_POST_RE = /\/20\d{2}\/\d{1,2}\//;
const DATE_LIKE_RE =
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})\b/gi;
const CHANGELOG_KEYWORD_RE = /\b(?:released|fixed|added|improved|new in|version|v\d+\.\d+)\b/i;
const VERSION_MARKER_RE = /\bv\d+\.\d+/gi;

function scoreCandidate(url: string, title: string, description: string): number {
  let score = 0;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if (HELP_SUBDOMAIN_RE.test(host)) score += 5;
    if (SCORE_PATH_TERMS.some((t) => path.includes(t))) score += 3;
    if (MARKETING_PATH_RE.test(path)) score -= 5;
    if (DATED_POST_RE.test(url)) score -= 3;
  } catch {
    // ignore unparseable URLs
  }
  const titleLower = title.toLowerCase();
  if (SCORE_PATH_TERMS.some((t) => titleLower.includes(t))) score += 2;
  if (CHANGELOG_KEYWORD_RE.test(description)) score += 1;
  return score;
}

function passesPrecheck(text: string): boolean {
  const dateMatches = text.match(DATE_LIKE_RE) ?? [];
  const distinctDates = new Set(dateMatches.map((d) => d.toLowerCase())).size;
  if (distinctDates >= 3) return true;

  const versionMatches = text.match(VERSION_MARKER_RE) ?? [];
  const distinctVersions = new Set(versionMatches.map((v) => v.toLowerCase())).size;
  return distinctVersions >= 2;
}

export async function discoverChangelog(
  domain: string | null,
  companyName: string | null,
  helpCentreUrl: string | null,
): Promise<DiscoveryResult> {
  if (!domain) return { url: null, candidatesJson: null };

  const rootDomain = domain.replace(/^www\./i, "").toLowerCase();
  const registrable = getDomain(rootDomain);

  let helpDomain: string | null = null;
  if (helpCentreUrl) {
    try {
      helpDomain = new URL(helpCentreUrl).hostname;
    } catch {
      // ignore
    }
  }

  const search = getSearchProvider();
  const allResults: Awaited<ReturnType<typeof search.search>> = [];

  // Q1: help-surface — constrained to the known help domain
  if (helpDomain) {
    try {
      const r = await search.search(`site:${helpDomain} changelog release notes`, 10);
      allResults.push(...r);
    } catch (error) {
      console.error("Changelog help-surface search failed", { domain, error });
    }
  }

  // Q2: broad — quoted company name + root domain to cut through generic names
  if (companyName) {
    try {
      const r = await search.search(`"${companyName}" ${rootDomain} changelog release notes`, 10);
      allResults.push(...r);
    } catch (error) {
      console.error("Changelog broad search failed", { domain, error });
    }
  }

  const candidates: ScoredCandidate[] = [];
  for (const r of allResults) {
    if (!registrable || getDomain(r.url) !== registrable) continue;
    try {
      const p = new URL(r.url).pathname;
      if (p === "/" || p === "") continue;
    } catch {
      continue;
    }
    candidates.push({ url: r.url, score: scoreCandidate(r.url, r.title, r.description), source: "search" });
  }

  if (candidates.length === 0) return { url: null, candidatesJson: null };

  // Deduplicate by URL, keep highest score
  const byUrl = new Map<string, ScoredCandidate>();
  for (const c of candidates) {
    const existing = byUrl.get(c.url);
    if (!existing || c.score > existing.score) byUrl.set(c.url, c);
  }

  const ranked = Array.from(byUrl.values()).sort((a, b) => b.score - a.score);
  const top5 = ranked.slice(0, 5);
  const candidatesJson = JSON.stringify(top5);

  // Content precheck — walk top 5, no trust-without-fetch
  for (const candidate of top5) {
    try {
      const res = await fetchWithTimeout(candidate.url);
      if (!res?.ok) continue;
      const text = await res.text();
      if (passesPrecheck(text.slice(0, 5000))) {
        return { url: candidate.url, candidatesJson };
      }
    } catch {
      // try next
    }
  }

  return { url: null, candidatesJson };
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
  changelog_type: "release_index" | "news_blog" | "single_post" | "not_a_changelog" | "none";
  release_velocity: "high" | "medium" | "low" | "unknown";
  freshness_signal: "fresh" | "stale" | "very_stale" | "unknown";
  freshness_confidence: "high" | "medium" | "low";
  tier3_rationale: string;
}

const CHANGELOG_TYPES = new Set(["release_index", "news_blog", "single_post", "not_a_changelog", "none"]);
const RELEASE_VELOCITIES = new Set(["high", "medium", "low", "unknown"]);
const FRESHNESS_SIGNALS = new Set(["fresh", "stale", "very_stale", "unknown"]);
const CONFIDENCE_VALUES = new Set(["high", "medium", "low"]);

function buildUserPrompt(domain: string | null, changelogContent: string, articleSample: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `Today's date: ${today}
Company domain: ${domain ?? "unknown"}

CHANGELOG CONTENT:
${changelogContent || "No changelog URL found or content could not be retrieved."}

ARTICLE SAMPLE (up to 5 articles):
${articleSample || "No articles could be retrieved."}`;
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) return trimmed.slice(start, end + 1);

  return trimmed;
}

function parseAnalysisJson(text: string): HaikuAnalysis {
  let parsed: Record<string, unknown>;
  const jsonText = extractJsonObject(text);
  try {
    parsed = JSON.parse(jsonText) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `Invalid Tier 3 analysis JSON: ${error instanceof Error ? error.message : String(error)}. Response: ${text.slice(
        0,
        500,
      )}`,
    );
  }

  if (
    typeof parsed.changelog_type !== "string" ||
    !CHANGELOG_TYPES.has(parsed.changelog_type) ||
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
    changelog_type: parsed.changelog_type as HaikuAnalysis["changelog_type"],
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
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic request failed: ${res.status} ${body.slice(0, 500)}`);
  }

  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const text = data.content?.find((part) => part.type === "text")?.text;
  if (!text) throw new Error("Anthropic response did not include text");

  return parseAnalysisJson(text);
}

async function analyzeWithHaiku(
  domain: string | null,
  changelogContent: string,
  articleSample: string,
): Promise<LlmAnalysis> {
  const userPrompt = buildUserPrompt(domain, changelogContent, articleSample);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await callHaiku(userPrompt);
    } catch (error) {
      console.error("Tier 3 Haiku analysis failed", {
        domain,
        attempt: attempt + 1,
        hasChangelogContent: changelogContent.length > 0,
        hasArticleSample: articleSample.length > 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return FAILED_ANALYSIS;
}
