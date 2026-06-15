import { db } from "@/lib/db";
import { nowInSeconds } from "@/lib/auth";
import { rowToAccount } from "@/lib/types";
import { runTier2 } from "@/lib/enrichment/tier2";
import { recalculateScore } from "@/lib/scoring";
import { sleep } from "@/lib/enrichment/utils";

export const runtime = "nodejs";
export const maxDuration = 300;

const FAILED_RESULT = {
  raw_page_count: null,
  primary_page_count: null,
  page_count_status: "not_found" as const,
  detected_languages: null,
};

export async function POST(request: Request) {
  const { tableId, accountIds } = (await request.json()) as { tableId: string; accountIds?: string[] };

  const dbResult = await db.execute({
    sql: "SELECT * FROM accounts WHERE table_id = ? ORDER BY created_at ASC",
    args: [tableId],
  });
  let accounts = dbResult.rows.map(rowToAccount).filter((a) => a.help_centre_url_status === "found");
  if (accountIds) {
    const idSet = new Set(accountIds);
    accounts = accounts.filter((a) => idSet.has(a.id));
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      for (let i = 0; i < accounts.length; i++) {
        if (i > 0) await sleep(500);
        const account = accounts[i];

        let tier2Result;
        try {
          tier2Result = await runTier2(account);
        } catch {
          tier2Result = FAILED_RESULT;
        }

        await db.execute({
          sql: `UPDATE accounts SET
              raw_page_count = ?,
              primary_page_count = ?,
              page_count_status = ?,
              detected_languages = COALESCE(?, detected_languages),
              tier2_enriched_at = ?
            WHERE id = ?`,
          args: [
            tier2Result.raw_page_count,
            tier2Result.primary_page_count,
            tier2Result.page_count_status,
            tier2Result.detected_languages,
            nowInSeconds(),
            account.id,
          ],
        });

        send({ accountId: account.id, field: "raw_page_count", value: tier2Result.raw_page_count });
        send({ accountId: account.id, field: "primary_page_count", value: tier2Result.primary_page_count });
        send({ accountId: account.id, field: "page_count_status", value: tier2Result.page_count_status });

        const scoreResult = await recalculateScore(account.id);
        send({ accountId: account.id, field: "pass1", value: scoreResult.pass1 });
        send({ accountId: account.id, field: "score", value: scoreResult.score });
        send({ accountId: account.id, field: "score_confidence", value: scoreResult.score_confidence });
        send({ accountId: account.id, field: "score_flags", value: JSON.stringify(scoreResult.score_flags) });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
