import type { Account } from "./types";

export interface ColumnDef {
  key: string;
  label: string;
  getValue: (account: Account) => string | number | null;
}

export function getContactName(account: Account): string {
  return [account.contact_first_name, account.contact_last_name]
    .filter((part) => part && part.length > 0)
    .join(" ");
}

/** Fixed account columns, in display and export order. */
export const FIXED_COLUMNS: ColumnDef[] = [
  { key: "company_name", label: "Company", getValue: (a) => a.company_name },
  { key: "domain", label: "Domain", getValue: (a) => a.domain },
  { key: "contact", label: "Contact", getValue: (a) => getContactName(a) },
  { key: "job_title", label: "Job title", getValue: (a) => a.job_title },
  { key: "email", label: "Email", getValue: (a) => a.email },
  { key: "email_confidence", label: "Email confidence", getValue: (a) => a.email_confidence },
  { key: "employee_count", label: "Employees", getValue: (a) => a.employee_count },
  { key: "hq_country", label: "Country", getValue: (a) => a.hq_country },
  { key: "funding_stage", label: "Funding stage", getValue: (a) => a.funding_stage },
  { key: "last_funding_date", label: "Last funding date", getValue: (a) => a.last_funding_date },
];

export interface EnrichmentColumnDef extends ColumnDef {
  /** 1 and 2 are run via the enrichment API; 3 covers inert stub columns. */
  tier: 1 | 2 | 3;
}

function multilingualLabel(account: Account): string | null {
  if (account.multilingual === null) return null;
  return account.multilingual ? "Yes" : "No";
}

function agentVendorLabel(account: Account): string | null {
  if (account.agent_vendor === null) return null;
  return account.agent_vendor === "none" ? "None" : account.agent_vendor;
}

function authenticationLabel(account: Account): string | null {
  if (account.requires_login === null) return null;
  return account.requires_login ? "Required" : "Not required";
}

const RELEASE_VELOCITY_LABELS: Record<string, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
  unknown: "Unknown",
};

const FRESHNESS_SIGNAL_LABELS: Record<string, string> = {
  fresh: "Fresh",
  stale: "Stale",
  very_stale: "Very stale",
  unknown: "Unknown",
};

const FRESHNESS_CONFIDENCE_LABELS: Record<string, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

function releaseVelocityLabel(account: Account): string | null {
  if (account.release_velocity === null) return null;
  return RELEASE_VELOCITY_LABELS[account.release_velocity] ?? account.release_velocity;
}

function freshnessSignalLabel(account: Account): string | null {
  if (account.freshness_signal === null) return null;
  return FRESHNESS_SIGNAL_LABELS[account.freshness_signal] ?? account.freshness_signal;
}

function freshnessConfidenceLabel(account: Account): string | null {
  if (account.freshness_confidence === null) return null;
  return FRESHNESS_CONFIDENCE_LABELS[account.freshness_confidence] ?? account.freshness_confidence;
}

function pass1Label(account: Account): string | null {
  if (account.pass1 === null) return null;
  return account.pass1 === 1 ? "Pass" : "Fail";
}

/** Enrichment columns, in display and export order. */
export const ENRICHMENT_COLUMNS: EnrichmentColumnDef[] = [
  { key: "help_centre_url", label: "Help centre URL", tier: 1, getValue: (a) => a.help_centre_url },
  { key: "platform", label: "Platform", tier: 1, getValue: (a) => a.platform },
  { key: "help_audience", label: "Help audience", tier: 1, getValue: (a) => a.help_audience },
  { key: "agent_vendor", label: "Agent vendor", tier: 1, getValue: agentVendorLabel },
  { key: "multilingual", label: "Multilingual", tier: 1, getValue: multilingualLabel },
  { key: "requires_login", label: "Authentication", tier: 1, getValue: authenticationLabel },
  { key: "raw_page_count", label: "Raw page count", tier: 2, getValue: (a) => a.raw_page_count },
  { key: "primary_page_count", label: "Primary page count", tier: 2, getValue: (a) => a.primary_page_count },
  { key: "changelog_url", label: "Changelog URL", tier: 3, getValue: (a) => a.changelog_url },
  { key: "release_velocity", label: "Release velocity", tier: 3, getValue: releaseVelocityLabel },
  { key: "freshness_signal", label: "Freshness signal", tier: 3, getValue: freshnessSignalLabel },
  { key: "freshness_confidence", label: "Confidence", tier: 3, getValue: freshnessConfidenceLabel },
  { key: "tier3_rationale", label: "Rationale", tier: 3, getValue: (a) => a.tier3_rationale },
  { key: "pass1", label: "Pass 1", tier: 3, getValue: pass1Label },
  { key: "score", label: "Score (partial)", tier: 3, getValue: (a) => a.score },
];
