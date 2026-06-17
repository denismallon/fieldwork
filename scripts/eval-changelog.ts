/**
 * Eval script: runs discoverChangelog against the manually-verified dataset
 * and reports precision / recall broken down by result type.
 *
 * Usage:
 *   cd c:/dev/fieldwork
 *   set -a && source <(grep -v '^#' .env.local | grep '=') && set +a
 *   npx tsx scripts/eval-changelog.ts
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Papa from "papaparse";
import { getDomain } from "tldts";
import { discoverChangelog } from "../src/lib/enrichment/tier3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

interface CsvRow {
  Company: string;
  Description: string;
  Website: string;
  "Help site": string;
  "Help platform": string;
  City: string;
  Country: string;
  "# Employees": string;
  "Changelog URL": string;
  "Changelog updated": string;
}

function extractDomain(website: string): string | null {
  let s = website.trim();
  if (!s) return null;
  if (!s.startsWith("http")) s = "https://" + s;
  try {
    const url = new URL(s);
    return url.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    const pathname = u.pathname.replace(/\/$/, "").toLowerCase() || "/";
    return host + pathname;
  } catch {
    return url.toLowerCase().replace(/\/$/, "");
  }
}

// ---------------------------------------------------------------------------
// Result classification
// ---------------------------------------------------------------------------

type EvalResult =
  | "exact"          // found URL normalises to the same as expected
  | "domain_match"   // found URL is on the same eTLD+1 as expected but different path
  | "off_domain"     // expected URL is on a different eTLD+1 from company site (unreachable by design)
  | "miss"           // expected URL exists but algorithm returned null
  | "false_positive" // no expected URL but algorithm found one
  | "true_negative"; // no expected URL and algorithm found nothing

function classifyResult(
  found: string | null,
  expected: string | null,
  companyDomain: string | null,
): EvalResult {
  const hasExpected = !!expected;
  const hasFound = !!found;

  if (!hasExpected) {
    return hasFound ? "false_positive" : "true_negative";
  }

  // Check if expected URL is on same eTLD+1 as company website
  const expectedReg = getDomain(expected);
  const companyReg = companyDomain ? getDomain(companyDomain) : null;
  const isOffDomain = !!expectedReg && !!companyReg && expectedReg !== companyReg;
  if (isOffDomain && !hasFound) return "off_domain";

  if (!hasFound) return "miss";

  const foundReg = getDomain(found);
  const normExpected = normalizeUrl(expected);
  const normFound = normalizeUrl(found);

  if (normFound === normExpected) return "exact";
  if (foundReg === expectedReg) return "domain_match";
  // Found something but it's on the wrong domain
  return "miss";
}

function truncate(s: string | null, len: number): string {
  if (!s) return "—";
  return s.length <= len ? s : s.slice(0, len - 1) + "…";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const csvPath = path.join(__dirname, "..", "evals", "Recently-funded-SaaS-June26.csv");
const raw = readFileSync(csvPath, "utf-8").replace(/^﻿/, ""); // strip BOM

const parsed = Papa.parse<CsvRow>(raw, { header: true, skipEmptyLines: true });
const rows = parsed.data.filter((r) => r.Company?.trim());

console.log(`\nChangelog discovery eval — ${rows.length} companies`);
if (!process.env.BRAVE_SEARCH_API_KEY) {
  console.log("⚠  BRAVE_SEARCH_API_KEY not set — search step will be skipped");
}
console.log();

const COL = { company: 20, domain: 18, expected: 42, found: 42, result: 14 };
const header =
  "Company".padEnd(COL.company) +
  "Domain".padEnd(COL.domain) +
  "Expected".padEnd(COL.expected) +
  "Found".padEnd(COL.found) +
  "Result";
console.log(header);
console.log("─".repeat(header.length + COL.result));

const RESULT_LABEL: Record<EvalResult, string> = {
  exact: "✓ exact",
  domain_match: "~ domain",
  off_domain: "⊘ off-domain",
  miss: "✗ miss",
  false_positive: "! false +ve",
  true_negative: "✓ TN",
};

async function main() {
  const counts: Record<EvalResult, number> = {
    exact: 0,
    domain_match: 0,
    off_domain: 0,
    miss: 0,
    false_positive: 0,
    true_negative: 0,
  };

  for (const row of rows) {
    const company = row.Company.trim();
    const domain = extractDomain(row.Website);
    const expected = row["Changelog URL"]?.trim() || null;

    let found: string | null = null;
    let error: string | null = null;
    try {
      const result = await discoverChangelog(domain, company, null);
      found = result.url;
    } catch (e) {
      error = e instanceof Error ? e.message.slice(0, 40) : String(e);
    }

    const result = error ? ("miss" as EvalResult) : classifyResult(found, expected, domain);
    counts[result]++;

    const resultStr = error ? `ERR: ${error}` : RESULT_LABEL[result];
    console.log(
      truncate(company, COL.company).padEnd(COL.company) +
        truncate(domain, COL.domain).padEnd(COL.domain) +
        truncate(expected, COL.expected).padEnd(COL.expected) +
        truncate(found, COL.found).padEnd(COL.found) +
        resultStr,
    );
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------

  const withChangelog = rows.filter((r) => r["Changelog URL"]?.trim()).length;
  const withoutChangelog = rows.length - withChangelog;
  const reachable = withChangelog - counts.off_domain;

  console.log();
  console.log("═".repeat(80));
  console.log("SUMMARY");
  console.log("─".repeat(80));
  console.log(`Total companies evaluated : ${rows.length}`);
  console.log(`  With known changelog    : ${withChangelog}`);
  console.log(`  Without changelog       : ${withoutChangelog}`);
  console.log();
  console.log("Discovery results (companies WITH expected changelog):");
  console.log(`  ✓ Exact match          : ${counts.exact}`);
  console.log(`  ~ Domain-level match   : ${counts.domain_match}`);
  console.log(`  ✗ Miss (found nothing) : ${counts.miss}`);
  console.log(`  ⊘ Off-domain (by design): ${counts.off_domain}`);
  console.log();
  console.log("Discovery results (companies WITHOUT expected changelog):");
  console.log(`  ✓ True negatives       : ${counts.true_negative}`);
  console.log(`  ! False positives      : ${counts.false_positive}`);
  console.log();

  const found_correctly = counts.exact + counts.domain_match;
  const recall = reachable > 0 ? ((found_correctly / reachable) * 100).toFixed(1) : "n/a";
  const precision_denom = found_correctly + counts.false_positive;
  const precision =
    precision_denom > 0 ? ((found_correctly / precision_denom) * 100).toFixed(1) : "n/a";

  console.log(`Recall  (found / reachable)  : ${found_correctly}/${reachable} = ${recall}%`);
  console.log(`Precision (correct / all found): ${found_correctly}/${precision_denom} = ${precision}%`);
  console.log();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
