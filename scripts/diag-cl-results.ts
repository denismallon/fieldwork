import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function main() {
  const { rows } = await db.execute({
    sql: `SELECT company_name, help_centre_url, changelog_url, tier3_rationale
          FROM accounts WHERE table_id = '526deb64-93be-445c-989a-743211bd67bd'
          ORDER BY company_name`,
    args: [],
  });
  for (const r of rows) {
    const hc = r.help_centre_url ? "hc" : "  ";
    const cl = r.changelog_url ? String(r.changelog_url).slice(0, 50) : "—";
    const rat = r.tier3_rationale ? String(r.tier3_rationale).slice(0, 45) : "(null — gate blocked)";
    console.log(hc, String(r.company_name ?? "").padEnd(22), cl.padEnd(52), rat);
  }
  const found = rows.filter(r => r.changelog_url).length;
  console.log(`\nTotal: ${rows.length}  With changelog: ${found}`);
}
main().catch(e => { console.error(e); process.exit(1); });
