import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { discoverHelpCentre } from "./helpCentre";
import { fetchWithTimeout, LANGUAGE_CODES } from "./utils";

export interface Tier1Result {
  help_centre_url: string | null;
  help_centre_url_status: "found" | "not_found";
  platform: string | null;
  help_audience: "non-technical" | "technical" | "unknown";
  agent_vendor: string;
  multilingual: 0 | 1;
  detected_languages: string | null;
}

const EMPTY_SIGNALS = {
  platform: null,
  help_audience: "unknown" as const,
  agent_vendor: "none",
  multilingual: 0 as const,
  detected_languages: null,
};

export async function runTier1(domain: string): Promise<Tier1Result> {
  const helpCentre = await discoverHelpCentre(domain);

  if (helpCentre.status === "not_found" || !helpCentre.url) {
    return { help_centre_url: null, help_centre_url_status: "not_found", ...EMPTY_SIGNALS };
  }

  const res = await fetchWithTimeout(helpCentre.url);
  if (!res || !res.ok) {
    return { help_centre_url: helpCentre.url, help_centre_url_status: "found", ...EMPTY_SIGNALS };
  }

  const html = await res.text();
  const pageUrl = res.url || helpCentre.url;
  const $ = cheerio.load(html);

  const platform = detectPlatform(pageUrl, html);
  const help_audience = await classifyAudience($, pageUrl, platform);
  const agent_vendor = detectAgentVendor($);
  const { multilingual, detected_languages } = detectMultilingual($, pageUrl);

  return {
    help_centre_url: helpCentre.url,
    help_centre_url_status: "found",
    platform,
    help_audience,
    agent_vendor,
    multilingual,
    detected_languages,
  };
}

// --- Step B: platform fingerprinting -------------------------------------

function scriptSources($: CheerioAPI): string[] {
  const sources: string[] = [];
  $("script[src]").each((_, el) => {
    const src = $(el).attr("src");
    if (src) sources.push(src.toLowerCase());
  });
  return sources;
}

function inlineScripts($: CheerioAPI): string {
  let combined = "";
  $("script").each((_, el) => {
    if (!$(el).attr("src")) combined += $(el).html() || "";
  });
  return combined.toLowerCase();
}

function detectPlatform(url: string, html: string): string | null {
  const lowerUrl = url.toLowerCase();
  const haystack = `${lowerUrl} ${html.toLowerCase()}`;

  if (haystack.includes(".zendesk.com") || haystack.includes("zdassets.com") || /\/hc\//.test(lowerUrl)) {
    return "Zendesk";
  }
  if (
    haystack.includes(".intercom.help") ||
    haystack.includes("intercom.com/help-center") ||
    haystack.includes("intercomcdn.com") ||
    haystack.includes("intercomassets.com")
  ) {
    return "Intercom";
  }
  if (haystack.includes(".freshdesk.com") || haystack.includes("freshworks.com/help")) {
    return "Freshdesk";
  }
  if (haystack.includes(".helpscoutdocs.com") || haystack.includes("helpscoutapp.com")) {
    return "HelpScout";
  }
  if (haystack.includes(".document360.com") || haystack.includes("document360.io")) {
    return "Document360";
  }
  if (haystack.includes(".gitbook.io") || haystack.includes("gitbook.com")) {
    return "GitBook";
  }
  if (haystack.includes(".notion.site")) {
    return "Notion";
  }
  return null;
}

// --- Step C: help audience classification ---------------------------------

const NON_TECHNICAL_PLATFORMS = new Set(["Zendesk", "Intercom", "Freshdesk", "HelpScout", "Document360"]);
const TECHNICAL_SUBDOMAIN_PREFIXES = new Set(["docs", "api", "developers"]);
const NON_TECHNICAL_SUBDOMAIN_PREFIXES = new Set(["help", "support"]);
const TECHNICAL_TERMS = ["api", "endpoint", "webhook", "authentication", "sdk", "curl", "json", "oauth"];

function subdomainPrefix(url: string): string {
  try {
    return new URL(url).hostname.split(".")[0].toLowerCase();
  } catch {
    return "";
  }
}

function countTechnicalTerms(text: string): number {
  const lower = text.toLowerCase();
  let count = 0;
  for (const term of TECHNICAL_TERMS) {
    const matches = lower.match(new RegExp(`\\b${term}\\b`, "g"));
    count += matches ? matches.length : 0;
  }
  return count;
}

function findArticleLinks($: CheerioAPI, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const seen = new Set<string>();
  const links: string[] = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.hostname !== base.hostname) return;
      if (resolved.pathname === base.pathname) return;
      const key = resolved.toString();
      if (!seen.has(key)) {
        seen.add(key);
        links.push(key);
      }
    } catch {
      // ignore invalid href
    }
  });

  return links;
}

async function classifyAudience(
  $: CheerioAPI,
  url: string,
  platform: string | null,
): Promise<"non-technical" | "technical" | "unknown"> {
  const prefix = subdomainPrefix(url);

  if (platform && NON_TECHNICAL_PLATFORMS.has(platform)) return "non-technical";
  if (NON_TECHNICAL_SUBDOMAIN_PREFIXES.has(prefix)) return "non-technical";
  if (TECHNICAL_SUBDOMAIN_PREFIXES.has(prefix)) return "technical";

  // Ambiguous (GitBook, Notion, custom, or unknown): inspect this page plus a
  // few linked articles for code blocks and technical terminology.
  let codeBlocks = $("code, pre").length;
  let technicalTerms = countTechnicalTerms($("body").text());

  const articleUrls = findArticleLinks($, url).slice(0, 3);
  for (const articleUrl of articleUrls) {
    const res = await fetchWithTimeout(articleUrl);
    if (!res || !res.ok) continue;
    const html = await res.text();
    const $$ = cheerio.load(html);
    codeBlocks += $$("code, pre").length;
    technicalTerms += countTechnicalTerms($$("body").text());
  }

  if (codeBlocks > 5 || technicalTerms > 10) return "technical";
  if (codeBlocks === 0 && technicalTerms === 0 && articleUrls.length === 0) return "unknown";
  return "non-technical";
}

// --- Step D: agent vendor detection ----------------------------------------

const AGENT_VENDOR_SIGNATURES: { name: string; test: (scripts: string[], inline: string) => boolean }[] = [
  {
    name: "Intercom Fin",
    test: (scripts, inline) =>
      scripts.some((s) => s.includes("intercomcdn.com")) ||
      inline.includes("window.intercom") ||
      inline.includes("intercomsettings"),
  },
  {
    name: "Zendesk AI",
    test: (scripts) =>
      scripts.some((s) => s.includes("zdassets.com") && (s.includes("messenger") || s.includes("web_widget"))),
  },
  {
    name: "Ada",
    test: (scripts, inline) => scripts.some((s) => s.includes("ada.support")) || inline.includes("adasettings"),
  },
  {
    name: "Forethought",
    test: (scripts) => scripts.some((s) => s.includes("forethought.ai")),
  },
  {
    name: "Freshchat",
    test: (scripts, inline) => scripts.some((s) => s.includes("freshchat.com")) || inline.includes("fcwidget"),
  },
  {
    name: "Tidio",
    test: (scripts, inline) => scripts.some((s) => s.includes("tidiochat.com")) || inline.includes("tidiochatapi"),
  },
];

function detectAgentVendor($: CheerioAPI): string {
  const scripts = scriptSources($);
  const inline = inlineScripts($);

  const matches = AGENT_VENDOR_SIGNATURES.filter((sig) => sig.test(scripts, inline)).map((sig) => sig.name);
  return matches.length > 0 ? matches.join(", ") : "none";
}

// --- Step E: multilingual detection -----------------------------------------

const LANGUAGE_PATH_REGEX = new RegExp(`^/(${LANGUAGE_CODES.join("|")})(/|$)`, "i");

function detectMultilingual(
  $: CheerioAPI,
  baseUrl: string,
): { multilingual: 0 | 1; detected_languages: string | null } {
  const codes = new Set<string>();

  // 1. hreflang alternates
  $('link[rel="alternate"][hreflang]').each((_, el) => {
    const lang = ($(el).attr("hreflang") || "").toLowerCase().split("-")[0];
    if (LANGUAGE_CODES.includes(lang)) codes.add(lang);
  });

  // 2. language-prefixed link paths
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    try {
      const resolved = new URL(href, baseUrl);
      const match = resolved.pathname.match(LANGUAGE_PATH_REGEX);
      if (match) codes.add(match[1].toLowerCase());
    } catch {
      // ignore invalid href
    }
  });

  // 3. language switcher (select with language-like options, or a switcher element)
  let hasSwitcher = false;
  $("select").each((_, el) => {
    const optionsText = $(el).find("option").text().toLowerCase();
    if (/\b(english|français|deutsch|español|language|idioma|sprache)\b/.test(optionsText)) {
      hasSwitcher = true;
    }
  });
  if (!hasSwitcher) {
    $("[class], [aria-label]").each((_, el) => {
      if (hasSwitcher) return;
      const cls = ($(el).attr("class") || "").toLowerCase();
      const aria = ($(el).attr("aria-label") || "").toLowerCase();
      if (cls.includes("lang") || cls.includes("locale") || aria.includes("language") || aria.includes("locale")) {
        hasSwitcher = true;
      }
    });
  }

  if (codes.size === 0 && !hasSwitcher) {
    return { multilingual: 0, detected_languages: null };
  }

  return { multilingual: 1, detected_languages: JSON.stringify([...codes].sort()) };
}
