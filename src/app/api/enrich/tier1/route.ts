import { db } from "@/lib/db";
import { nowInSeconds } from "@/lib/auth";
import { rowToAccount } from "@/lib/types";
import { runTier1 } from "@/lib/enrichment/tier1";
import { sleep } from "@/lib/enrichment/utils";

export const runtime = "nodejs";
export const maxDuration = 300;

const FAILED_SIGNALS = {
  help_centre_url: null,
  help_centre_url_status: "not_found" as const,
  platform: null,
  help_audience: "unknown" as const,
  agent_vendor: "none",
  multilingual: 0 as const,
  detected_languages: null,
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

        let signals;
        try {
          signals = await runTier1(account.domain!);
        } catch {
          signals = FAILED_SIGNALS;
        }

        await db.execute({
          sql: `UPDATE accounts SET
              help_centre_url = ?,
              help_centre_url_status = ?,
              platform = ?,
              help_audience = ?,
              agent_vendor = ?,
              multilingual = ?,
              detected_languages = ?,
              tier1_enriched_at = ?
            WHERE id = ?`,
          args: [
            signals.help_centre_url,
            signals.help_centre_url_status,
            signals.platform,
            signals.help_audience,
            signals.agent_vendor,
            signals.multilingual,
            signals.detected_languages,
            nowInSeconds(),
            account.id,
          ],
        });

        send({ accountId: account.id, field: "help_centre_url", value: signals.help_centre_url });
        send({ accountId: account.id, field: "platform", value: signals.platform });
        send({ accountId: account.id, field: "help_audience", value: signals.help_audience });
        send({ accountId: account.id, field: "agent_vendor", value: signals.agent_vendor });
        send({ accountId: account.id, field: "multilingual", value: signals.multilingual });
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
