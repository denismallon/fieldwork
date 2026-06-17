/**
 * Diagnostic: for the first N accounts with a found help centre, run the
 * actual Brave searches and show exactly why each result passes or fails.
 *
 * Usage (PowerShell):
 *   cd c:\dev\fieldwork
 *   Get-Content .env.local | Where-Object { $_ -notmatch '^#' -and $_ -match '=' } | ForEach-Object { $k,$v = $_ -split '=',2; [System.Environment]::SetEnvironmentVariable($k.Trim(),$v.Trim()) }
 *   npx tsx scripts/diag-changelog-search.ts
 */

import { createClient } from "@libsql/client";
import { getDomain } from "tldts";
import { rowToAccount } from "../src/lib/types";
import { fetchWithTimeout } from "../src/lib/enrichment/utils";

const LIMIT = 5; // how many accounts to probe

// ── env ───────────────────────────────────────────────────────────────────────

const BRAVE_KEY = process.env.BRAVE_SEARCH_API_KEY;
const DB_URL = process.env.TURSO_DATABASE_URL;
const DB_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!BRAVE_KEY) { console.error("BRAVE_SEARCH_API_KEY not set"); process.exit(1); }
if (!DB_URL)    { console.error("TURSO_DATABASE_URL not set");    process.exit(1); }

// ── helpers ───────────────────────────────────────────────────────────────────

async function braveSearch(query: string): Promise<Array<{ url: string; title: string; description: string }>> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "10");
  const res = await fetch(url.toString(), {
    headers: { "X-Subscription-Token": BRAVE_KEY!, Accept: "application/json" },
  });
  if (!res.ok) { console.error(`  Brave HTTP ${res.status}`); return []; }
  const data = (await res.json()) as { web?: { results?: Array<{ url?: string; title?: string; description?: string }> } };
  return (data.web?.results ?? []).flatMap((r) =>
    r.url ? [{ url: r.url, title: r.title ?? "", description: r.description ?? "" }] : [],
  );
}

function pad(s: string, n: number) { return s.length >= n ? s.slice(0, n) : s.padEnd(n); }

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
const db = createClient({ url: DB_URL!, authToken: DB_TOKEN });

const { rows } = await db.execute(
  `SELECT * FROM accounts WHERE help_centre_url_status = 'found' AND help_centre_url IS NOT NULL LIMIT ${LIMIT}`,
);
const accounts = rows.map(rowToAccount);

if (accounts.length === 0) {
  console.log("No accounts with a found help centre.");
  process.exit(0);
}

for (const account of accounts) {
  console.log(`\n${"═".repeat(90)}`);
  console.log(`Company : ${account.company_name ?? "(null)"}`);
  console.log(`Domain  : ${account.domain ?? "(null)"}`);
  console.log(`Help URL: ${account.help_centre_url ?? "(null)"}`);

  if (!account.domain) { console.log("  ⚠  No domain — skipped"); continue; }

  const rootDomain = account.domain.replace(/^www\./i, "").toLowerCase();
  const registrable = getDomain(rootDomain);
  let helpDomain: string | null = null;
  try { if (account.help_centre_url) helpDomain = new URL(account.help_centre_url).hostname; } catch { /**/ }

  console.log(`rootDomain=${rootDomain}  registrable=${registrable}  helpDomain=${helpDomain}`);

  type Tagged = { url: string; title: string; description: string; source: "help_surface" | "broad" };
  const allResults: Tagged[] = [];

  if (helpDomain) {
    const q = `site:${helpDomain} changelog release notes`;
    console.log(`\n  Q1 (help_surface): ${q}`);
    const r = await braveSearch(q);
    console.log(`  → ${r.length} results from Brave`);
    allResults.push(...r.map((x) => ({ ...x, source: "help_surface" as const })));
    for (const x of r) console.log(`     ${pad(x.url, 70)}`);
  } else {
    console.log("\n  Q1: skipped (no helpDomain)");
  }

  if (account.company_name) {
    const q = `"${account.company_name}" ${rootDomain} changelog release notes`;
    console.log(`\n  Q2 (broad): ${q}`);
    const r = await braveSearch(q);
    console.log(`  → ${r.length} results from Brave`);
    allResults.push(...r.map((x) => ({ ...x, source: "broad" as const })));
    for (const x of r) console.log(`     ${pad(x.url, 70)}`);
  } else {
    console.log("\n  Q2: skipped (no company_name)");
  }

  const SCORE_PATH_TERMS = ["changelog", "release-notes", "releases", "whats-new", "whatsnew"];
  const CHANGELOG_TITLE_RE = /\b(?:changelog|change\s+log|release\s+notes?|releases|what'?s\s+new|product\s+updates?)\b/i;
  function hasChangelogSignal(url: string, title: string): boolean {
    try {
      const path = new URL(url).pathname.toLowerCase();
      if (SCORE_PATH_TERMS.some((t) => path.includes(t))) return true;
    } catch { /**/ }
    return CHANGELOG_TITLE_RE.test(title);
  }

  console.log(`\n  ── Filter stage (${allResults.length} total results) ──`);
  const passing: Tagged[] = [];
  for (const r of allResults) {
    const resultRegistrable = getDomain(r.url);
    let pathname = "/";
    try { pathname = new URL(r.url).pathname; } catch { /**/ }

    if (r.source === "broad" && (!registrable || resultRegistrable !== registrable)) {
      console.log(`  ✗ [${r.source}] DOMAIN_FILTER    ${r.url.slice(0, 65)}`);
      console.log(`      result_reg=${resultRegistrable}  need=${registrable}`);
      continue;
    }
    if (pathname === "/" || pathname === "") {
      console.log(`  ✗ [${r.source}] ROOT_PATH        ${r.url.slice(0, 65)}`);
      continue;
    }
    if (!hasChangelogSignal(r.url, r.title)) {
      console.log(`  ✗ [${r.source}] NO_SIGNAL        ${r.url.slice(0, 65)}  title="${r.title.slice(0, 40)}"`);
      continue;
    }
    console.log(`  ✓ [${r.source}] PASSES           ${r.url.slice(0, 65)}  title="${r.title.slice(0, 40)}"`);
    passing.push(r);
  }

  if (passing.length === 0) { console.log("\n  → No candidates after filter. Done."); continue; }

  console.log(`\n  ── Liveness check (top 5 of ${passing.length} candidates) ──`);
  const top5 = passing.slice(0, 5);
  for (const c of top5) {
    let outcome = "?";
    let detail = "";
    try {
      const res = await fetchWithTimeout(c.url, { method: "HEAD" });
      if (res?.ok) {
        outcome = "LIVE";
      } else {
        outcome = "DEAD";
        detail = `HTTP ${res?.status ?? "no response"}`;
      }
    } catch (e) {
      outcome = "ERROR";
      detail = String(e).slice(0, 80);
    }
    const icon = outcome === "LIVE" ? "✓" : "✗";
    console.log(`  ${icon} ${outcome.padEnd(6)} ${c.url.slice(0, 70)}`);
    if (detail) console.log(`      ${detail}`);
  }
  const winner = top5.find(() => true); // first live candidate is what tier3 would pick
  console.log(`\n  → Would return: ${winner?.url ?? "null"} (pending liveness)`)
}

console.log(`\n${"═".repeat(90)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
