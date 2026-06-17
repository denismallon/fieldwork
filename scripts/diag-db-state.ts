/**
 * Quick diagnostic: show help_centre_url_status, pass1, and tier3 state
 * for all accounts in the "Recently funded SaaS - June 26" table.
 */

import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function main() {
  // List all tables first
  const allTables = await db.execute({ sql: "SELECT id, name FROM fieldwork_tables ORDER BY created_at DESC LIMIT 15", args: [] });
  console.log("All tables:");
  for (const r of allTables.rows) console.log(" ", r.id, r.name);
  console.log();

  // Find the table
  const tables = await db.execute({
    sql: "SELECT id, name FROM fieldwork_tables WHERE name LIKE '%June 26%'",
    args: [],
  });

  if (tables.rows.length === 0) {
    console.log("No 'June 26' table found.");
    return;
  }

  // Use the most recently created June 26 table
  const tableRow = tables.rows[tables.rows.length - 1];
  const tableId = tableRow.id as string;
  console.log(`\nUsing table: ${tableRow.name} (${tableId})\n`);

  const { rows } = await db.execute({
    sql: `SELECT company_name, domain, help_centre_url, help_centre_url_status, pass1,
               changelog_url, tier3_rationale, tier3_enriched_at
          FROM accounts WHERE table_id = ? ORDER BY company_name`,
    args: [tableId],
  });

  console.log(
    "Company".padEnd(22) +
    "hc_status".padEnd(14) +
    "pass1".padEnd(7) +
    "t3_ran".padEnd(8) +
    "changelog_url"
  );
  console.log("─".repeat(100));

  let nullStatus = 0, foundStatus = 0, notFoundStatus = 0, otherStatus = 0;

  for (const r of rows) {
    const status = r.help_centre_url_status as string | null;
    const t3ran = r.tier3_enriched_at ? "yes" : "no";
    const clUrl = r.changelog_url ? String(r.changelog_url).slice(0, 40) : "—";
    const pass1 = r.pass1 !== null ? String(r.pass1) : "null";

    console.log(
      String(r.company_name ?? "").slice(0, 21).padEnd(22) +
      String(status ?? "null").padEnd(14) +
      pass1.padEnd(7) +
      t3ran.padEnd(8) +
      clUrl
    );

    if (status === null) nullStatus++;
    else if (status === "found") foundStatus++;
    else if (status === "not_found") notFoundStatus++;
    else otherStatus++;
  }

  console.log("\n─".repeat(100));
  console.log(`\nStatus counts (${rows.length} total):`);
  console.log(`  "found"      : ${foundStatus}`);
  console.log(`  "not_found"  : ${notFoundStatus}`);
  console.log(`  null         : ${nullStatus}`);
  console.log(`  other        : ${otherStatus}`);

  const t3ran = rows.filter(r => r.tier3_enriched_at).length;
  console.log(`\nTier 3 ran: ${t3ran} / ${rows.length}`);
  console.log(`With changelog_url: ${rows.filter(r => r.changelog_url).length}`);

  // show rows that have help_centre_url but NOT status="found"
  const mismatch = rows.filter(r => r.help_centre_url && r.help_centre_url_status !== "found");
  if (mismatch.length > 0) {
    console.log(`\n⚠  Rows with help_centre_url but status != "found": ${mismatch.length}`);
    for (const r of mismatch) {
      console.log(`  ${String(r.company_name).padEnd(22)} status=${r.help_centre_url_status ?? "null"}  url=${String(r.help_centre_url).slice(0, 50)}`);
    }
  }

  // Show rows that passed gate but got no changelog
  const gatePass = rows.filter(r => r.help_centre_url_status === "found" && r.pass1 && Number(r.pass1) > 0);
  const gotChangelog = gatePass.filter(r => r.changelog_url);
  console.log(`\nRows that should pass tier3 gate (status=found AND pass1>0): ${gatePass.length}`);
  console.log(`Of those, with changelog_url: ${gotChangelog.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
