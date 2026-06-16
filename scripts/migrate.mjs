import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const url = process.env.TURSO_DATABASE_URL;
if (!url) {
  console.error("TURSO_DATABASE_URL is not set");
  process.exit(1);
}

const client = createClient({
  url,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const schema = readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf-8");

await client.executeMultiple(schema);

console.log("Schema applied successfully.");

// `CREATE TABLE IF NOT EXISTS` won't add new columns to an existing table, so
// reconcile the accounts table with any columns added since it was created.
const ENRICHMENT_COLUMNS = [
  ["help_centre_url", "TEXT"],
  ["help_centre_url_status", "TEXT"],
  ["platform", "TEXT"],
  ["help_audience", "TEXT"],
  ["agent_vendor", "TEXT"],
  ["multilingual", "INTEGER"],
  ["detected_languages", "TEXT"],
  ["requires_login", "INTEGER"],
  ["raw_page_count", "INTEGER"],
  ["primary_page_count", "INTEGER"],
  ["page_count_status", "TEXT"],
  ["changelog_url", "TEXT"],
  ["release_velocity", "TEXT"],
  ["release_velocity_source", "TEXT"],
  ["freshness_signal", "TEXT"],
  ["freshness_confidence", "TEXT"],
  ["freshness_source", "TEXT"],
  ["tier3_rationale", "TEXT"],
  ["pass1", "INTEGER"],
  ["score", "INTEGER"],
  ["score_confidence", "TEXT"],
  ["score_flags", "TEXT"],
  ["tier1_enriched_at", "INTEGER"],
  ["tier2_enriched_at", "INTEGER"],
  ["tier3_enriched_at", "INTEGER"],
  ["changelog_type", "TEXT"],
  ["changelog_candidates", "TEXT"],
];

const tableInfo = await client.execute("PRAGMA table_info(accounts)");
const existingColumns = new Set(tableInfo.rows.map((row) => String(row.name)));

for (const [name, type] of ENRICHMENT_COLUMNS) {
  if (!existingColumns.has(name)) {
    await client.execute(`ALTER TABLE accounts ADD COLUMN ${name} ${type}`);
    console.log(`Added column accounts.${name}`);
  }
}

client.close();
