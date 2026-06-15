"use server";

import { db } from "@/lib/db";
import { TIER_DOWNSTREAM_FIELDS } from "@/lib/columns";
import { recalculateScore, type ScoreResult } from "@/lib/scoring";

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

/**
 * Nulls out the fields a later tier derived from `tier`'s output, then
 * recalculates the score for each affected row. Returns the new score per
 * account id so the caller can update local state without a refetch.
 */
export async function wipeDownstreamFields(
  tableId: string,
  ids: string[],
  tier: 1 | 2,
): Promise<Record<string, ScoreResult>> {
  if (ids.length === 0) return {};

  const fields = TIER_DOWNSTREAM_FIELDS[tier];
  const setClause = fields.map((f) => `${f} = NULL`).join(", ");
  const placeholders = ids.map(() => "?").join(",");
  await db.execute({
    sql: `UPDATE accounts SET ${setClause} WHERE table_id = ? AND id IN (${placeholders})`,
    args: [tableId, ...ids],
  });

  const scores: Record<string, ScoreResult> = {};
  for (const id of ids) {
    scores[id] = await recalculateScore(id);
  }
  return scores;
}
