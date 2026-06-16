import { db } from "./db";
import { rowToAccount, type Account } from "./types";

export interface ScoreResult {
  pass1: number | null;
  score: number | null;
  score_confidence: string | null;
  score_flags: string[];
}

const PAGE_COUNT_LOW_BAND = [280, 320] as const;
const PAGE_COUNT_HIGH_BAND = [1900, 2100] as const;

function computePass1(account: Account): number | null {
  if (account.help_centre_url_status === null) return null;
  if (account.help_centre_url_status !== "found") return 0;
  if (account.primary_page_count === null) return null;
  return account.primary_page_count >= 300 && account.primary_page_count <= 2000 ? 1 : 0;
}

function computeAgentVendorScore(account: Account): number {
  return account.agent_vendor && account.agent_vendor !== "none" ? 30 : 0;
}

function computeMultilingualScore(account: Account): number {
  return account.multilingual === 1 ? 20 : 0;
}

function computeFundingScore(account: Account): number {
  if (!account.last_funding_date) return 0;
  const fundingDate = new Date(account.last_funding_date);
  if (Number.isNaN(fundingDate.getTime())) return 0;

  const now = new Date();
  const months = (now.getFullYear() - fundingDate.getFullYear()) * 12 + (now.getMonth() - fundingDate.getMonth());
  if (months <= 24) return 10;
  if (months <= 48) return 5;
  return 0;
}

const DRIFT_MATRIX: Record<string, Record<string, number>> = {
  high: { fresh: 0, stale: 32, very_stale: 40 },
  medium: { fresh: 0, stale: 20, very_stale: 28 },
  low: { fresh: 0, stale: 5, very_stale: 10 },
};

function computeDriftRatio(account: Account, flags: string[]): number {
  const velocity = account.release_velocity;
  const freshness = account.freshness_signal;
  const freshnessConfidence = account.freshness_confidence;

  if (freshnessConfidence === "low") {
    flags.push("Low confidence Tier 3 analysis — verify manually");
  }
  if (velocity === "unknown" || velocity === null) {
    const ct = account.changelog_type;
    if (ct === "news_blog") {
      flags.push("Changelog URL is a news/blog page, not a release index — velocity unmeasured");
    } else if (ct === "single_post") {
      flags.push("Changelog URL is a single post, not the release index — velocity unmeasured");
    } else if (ct === "not_a_changelog") {
      flags.push("Detected changelog URL is not a changelog — velocity unmeasured");
    } else if (ct === "none" || velocity === null) {
      flags.push("No changelog found — release/freshness not assessed");
    } else {
      // release_index where dates weren't parseable
      flags.push("Release velocity unknown: no dated changelog found");
    }
  }

  // null = no real changelog present → 0 contribution (not the neutral 20-pt midpoint)
  if (velocity === null || freshness === null) {
    return 0;
  }
  // 'unknown' on a real release_index → neutral midpoint
  if (velocity === "unknown" || freshness === "unknown" || !freshnessConfidence) {
    return 20;
  }

  return DRIFT_MATRIX[velocity]?.[freshness] ?? 20;
}

function computeScoreConfidence(account: Account): "high" | "medium" | "low" {
  if (
    account.freshness_confidence === "high" ||
    account.freshness_confidence === "medium" ||
    account.freshness_confidence === "low"
  ) {
    return account.freshness_confidence;
  }
  return "low";
}

export function computeScoreResult(account: Account): ScoreResult {
  const pass1 = computePass1(account);
  const flags: string[] = [];

  const ppc = account.primary_page_count;
  if (
    ppc !== null &&
    ((ppc >= PAGE_COUNT_LOW_BAND[0] && ppc <= PAGE_COUNT_LOW_BAND[1]) ||
      (ppc >= PAGE_COUNT_HIGH_BAND[0] && ppc <= PAGE_COUNT_HIGH_BAND[1]))
  ) {
    flags.push("Page count near Pass 1 threshold — verify before outreach");
  }

  if (pass1 !== 1) {
    return { pass1, score: null, score_confidence: null, score_flags: flags };
  }

  const score =
    computeAgentVendorScore(account) +
    computeDriftRatio(account, flags) +
    computeMultilingualScore(account) +
    computeFundingScore(account);

  return { pass1, score, score_confidence: computeScoreConfidence(account), score_flags: flags };
}

/** Re-reads the row, recomputes pass1/score/confidence/flags, and persists them. */
export async function recalculateScore(accountId: string): Promise<ScoreResult> {
  const result = await db.execute({ sql: "SELECT * FROM accounts WHERE id = ?", args: [accountId] });
  const account = rowToAccount(result.rows[0]);

  const scoreResult = computeScoreResult(account);

  await db.execute({
    sql: `UPDATE accounts SET pass1 = ?, score = ?, score_confidence = ?, score_flags = ? WHERE id = ?`,
    args: [
      scoreResult.pass1,
      scoreResult.score,
      scoreResult.score_confidence,
      JSON.stringify(scoreResult.score_flags),
      accountId,
    ],
  });

  return scoreResult;
}
