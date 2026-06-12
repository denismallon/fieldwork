"use server";

import { db } from "@/lib/db";

export async function renameTable(tableId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Table name cannot be empty");

  await db.execute({
    sql: "UPDATE fieldwork_tables SET name = ? WHERE id = ?",
    args: [trimmed, tableId],
  });
}

export async function deleteAccounts(tableId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  const placeholders = ids.map(() => "?").join(",");
  await db.execute({
    sql: `DELETE FROM accounts WHERE table_id = ? AND id IN (${placeholders})`,
    args: [tableId, ...ids],
  });
}
