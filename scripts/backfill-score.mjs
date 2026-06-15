import { createClient } from "@libsql/client";
import { recalculateScore } from "../src/lib/scoring.ts";

const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const result = await db.execute("SELECT id, company_name FROM accounts");
for (const row of result.rows) {
  const score = await recalculateScore(String(row.id));
  console.log(row.company_name, score);
}

db.close();
