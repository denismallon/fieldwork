"use server";

import { db } from "@/lib/db";
import { nowInSeconds } from "@/lib/auth";
import type { AccountInput } from "@/lib/types";

export type ImportDestination =
  | { type: "new"; name: string }
  | { type: "existing"; tableId: string };

export interface ImportResult {
  tableId: string;
  imported: number;
  duplicates: number;
}

export async function importAccounts(
  rows: AccountInput[],
  destination: ImportDestination,
): Promise<ImportResult> {
  const now = nowInSeconds();

  let tableId: string;
  if (destination.type === "new") {
    const name = destination.name.trim();
    if (!name) throw new Error("Table name is required");

    tableId = crypto.randomUUID();
    await db.execute({
      sql: "INSERT INTO fieldwork_tables (id, name, created_at) VALUES (?, ?, ?)",
      args: [tableId, name, now],
    });
  } else {
    tableId = destination.tableId;
    const existingTable = await db.execute({
      sql: "SELECT id FROM fieldwork_tables WHERE id = ?",
      args: [tableId],
    });
    if (existingTable.rows.length === 0) throw new Error("Destination table not found");
  }

  // Duplicate domain detection: a row counts as a duplicate if its domain
  // already exists in the table (either previously, or earlier in this batch).
  const existingDomains = await db.execute({
    sql: "SELECT domain FROM accounts WHERE table_id = ?",
    args: [tableId],
  });

  const seenDomains = new Set<string>();
  for (const row of existingDomains.rows) {
    const domain = row.domain ? String(row.domain).toLowerCase() : "";
    if (domain) seenDomains.add(domain);
  }

  let duplicates = 0;
  for (const row of rows) {
    const domain = row.domain ? row.domain.toLowerCase() : "";
    if (!domain) continue;
    if (seenDomains.has(domain)) {
      duplicates++;
    } else {
      seenDomains.add(domain);
    }
  }

  if (rows.length > 0) {
    await db.batch(
      rows.map((row) => ({
        sql: `INSERT INTO accounts (
          id, table_id, company_name, domain, contact_first_name, contact_last_name,
          job_title, email, email_confidence, employee_count, hq_country,
          funding_stage, last_funding_date, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          crypto.randomUUID(),
          tableId,
          row.company_name,
          row.domain,
          row.contact_first_name,
          row.contact_last_name,
          row.job_title,
          row.email,
          row.email_confidence,
          row.employee_count,
          row.hq_country,
          row.funding_stage,
          row.last_funding_date,
          now,
        ],
      })),
      "write",
    );
  }

  return { tableId, imported: rows.length, duplicates };
}
