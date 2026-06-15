import { db } from "@/lib/db";
import { nowInSeconds } from "@/lib/auth";
import { rowToAccount } from "@/lib/types";
import { runTier3, type Tier3Result } from "@/lib/enrichment/tier3";
import { recalculateScore } from "@/lib/scoring";
import { sleep } from "@/lib/enrichment/utils";

export const runtime = "nodejs";
export const maxDuration = 300;

const FAILED_RESULT: Tier3Result = {
  changelog_url: null,
  release_velocity: "unknown",
  release_velocity_source: "unknown",
  freshness_signal: "unknown",
  freshness_confidence: "unmeasurable",
  freshness_source: "unknown",
};

export async function POST(request: Request) {
  const { tableId } = (await request.json()) as { tableId: string };

  const dbResult = await db.execute({
    sql: "SELECT * FROM accounts WHERE table_id = ? ORDER BY created_at ASC",
    args: [tableId],
  });
  const accounts = dbResult.rows.map(rowToAccount).filter((a) => a.domain);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      for (let i = 0; i < accounts.length; i++) {
        if (i > 0) await sleep(500);
        const account = accounts[i];

        let tier3Result: Tier3Result;
        try {
          tier3Result = await runTier3(account);
        } catch {
          tier3Result = FAILED_RESULT;
        }

        await db.execute({
          sql: `UPDATE accounts SET
              changelog_url = ?,
              release_velocity = ?,
              release_velocity_source = ?,
              freshness_signal = ?,
              freshness_confidence = ?,
              freshness_source = ?,
              tier3_enriched_at = ?
            WHERE id = ?`,
          args: [
            tier3Result.changelog_url,
            tier3Result.release_velocity,
            tier3Result.release_velocity_source,
            tier3Result.freshness_signal,
            tier3Result.freshness_confidence,
            tier3Result.freshness_source,
            nowInSeconds(),
            account.id,
          ],
        });

        send({ accountId: account.id, field: "changelog_url", value: tier3Result.changelog_url });
        send({ accountId: account.id, field: "release_velocity", value: tier3Result.release_velocity });
        send({ accountId: account.id, field: "freshness_signal", value: tier3Result.freshness_signal });
        send({ accountId: account.id, field: "freshness_confidence", value: tier3Result.freshness_confidence });

        const scoreResult = await recalculateScore(account.id);
        send({ accountId: account.id, field: "pass1", value: scoreResult.pass1 });
        send({ accountId: account.id, field: "score", value: scoreResult.score });
        send({ accountId: account.id, field: "score_confidence", value: scoreResult.score_confidence });
        send({ accountId: account.id, field: "score_flags", value: JSON.stringify(scoreResult.score_flags) });
        send({ accountId: account.id, field: "tier3_enriched_at", value: nowInSeconds() });
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
