/**
 * Compare manually-verified changelog URLs in the CSV against the current DB values.
 * No Brave searches — just a diff of what we found vs what's correct.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Papa from "papaparse";
import { createClient } from "@libsql/client";
import { getDomain } from "tldts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface CsvRow {
  Company: string;
  Domain: string;
  "Changelog URL verified": string;
  "Pass 1": string;
}

function normHost(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./i, "").toLowerCase(); } catch { return ""; }
}

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function main() {
  const csvPath = path.join(__dirname, "..", "evals", "Large-SaaS-UK_EU-June26.csv");
  const raw = readFileSync(csvPath, "utf-8").replace(/^﻿/, "");
  const { data } = Papa.parse<CsvRow>(raw, { header: true, skipEmptyLines: true });

  // Load all DB rows for this table
  const { rows: dbRows } = await db.execute({
    sql: `SELECT company_name, domain, changelog_url, tier3_rationale
          FROM accounts WHERE table_id = '66e903b9-c149-465a-a152-3407f11a633b'`,
    args: [],
  });

  // Index DB rows by domain (normalised)
  const byDomain = new Map<string, typeof dbRows[0]>();
  for (const r of dbRows) {
    if (r.domain) byDomain.set(String(r.domain).toLowerCase(), r);
  }

  type Result = "exact" | "domain_match" | "off_domain" | "miss" | "false_positive" | "true_negative";
  const counts: Record<Result, number> = {
    exact: 0, domain_match: 0, off_domain: 0, miss: 0, false_positive: 0, true_negative: 0,
  };

  const COL = { company: 22, expected: 45, found: 45, result: 16 };
  console.log(
    "\nLarge SaaS UK/EU — DB vs verified CSV\n" +
    "Company".padEnd(COL.company) +
    "Verified URL".padEnd(COL.expected) +
    "DB URL".padEnd(COL.found) +
    "Result"
  );
  console.log("─".repeat(COL.company + COL.expected + COL.found + COL.result));

  const LABEL: Record<Result, string> = {
    exact: "✓ exact",
    domain_match: "~ domain",
    off_domain: "⊘ off-domain",
    miss: "✗ miss",
    false_positive: "! false +ve",
    true_negative: "✓ TN",
  };

  for (const row of data) {
    const company = row.Company.trim();
    const csvDomain = row.Domain.trim().replace(/^www\./i, "").toLowerCase();
    const verified = row["Changelog URL verified"]?.trim() || null;
    const dbRow = byDomain.get(csvDomain);
    const found = dbRow?.changelog_url ? String(dbRow.changelog_url) : null;

    let result: Result;
    if (!verified) {
      result = found ? "false_positive" : "true_negative";
    } else {
      const verifiedReg = getDomain(verified);
      const csvReg = getDomain(csvDomain);
      const isOffDomain = !!verifiedReg && !!csvReg && verifiedReg !== csvReg;
      if (!found) {
        result = isOffDomain ? "off_domain" : "miss";
      } else {
        const foundHost = normHost(found);
        const verifiedHost = normHost(verified);
        if (foundHost === verifiedHost) result = "exact";
        else if (getDomain(found) === verifiedReg) result = "domain_match";
        else result = "miss";
      }
    }

    counts[result]++;

    const trunc = (s: string | null, n: number) =>
      !s ? "—" : s.length <= n ? s : s.slice(0, n - 1) + "…";

    console.log(
      trunc(company, COL.company).padEnd(COL.company) +
      trunc(verified, COL.expected).padEnd(COL.expected) +
      trunc(found, COL.found).padEnd(COL.found) +
      LABEL[result]
    );
  }

  const withChangelog = data.filter(r => r["Changelog URL verified"]?.trim()).length;
  const offDomainCount = counts.off_domain;
  const reachable = withChangelog - offDomainCount;
  const correctlyFound = counts.exact + counts.domain_match;
  const recall = reachable > 0 ? ((correctlyFound / reachable) * 100).toFixed(1) : "n/a";
  const precisionDenom = correctlyFound + counts.false_positive;
  const precision = precisionDenom > 0 ? ((correctlyFound / precisionDenom) * 100).toFixed(1) : "n/a";

  console.log("\n" + "═".repeat(COL.company + COL.expected + COL.found + COL.result));
  console.log(`Total rows: ${data.length}  |  With verified changelog: ${withChangelog}  |  Without: ${data.length - withChangelog}`);
  console.log(`\n  ✓ Exact match      : ${counts.exact}`);
  console.log(`  ~ Domain match     : ${counts.domain_match}`);
  console.log(`  ✗ Miss             : ${counts.miss}`);
  console.log(`  ⊘ Off-domain       : ${counts.off_domain}`);
  console.log(`  ✓ True negative    : ${counts.true_negative}`);
  console.log(`  ! False positive   : ${counts.false_positive}`);
  console.log(`\nRecall    (found / reachable)   : ${correctlyFound}/${reachable} = ${recall}%`);
  console.log(`Precision (correct / all found) : ${correctlyFound}/${precisionDenom} = ${precision}%\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
