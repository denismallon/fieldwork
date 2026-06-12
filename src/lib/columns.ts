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

/** Enrichment columns, in display and export order. */
export const ENRICHMENT_COLUMNS: EnrichmentColumnDef[] = [
  { key: "help_centre_url", label: "Help centre URL", tier: 1, getValue: (a) => a.help_centre_url },
  { key: "platform", label: "Platform", tier: 1, getValue: (a) => a.platform },
  { key: "help_audience", label: "Help audience", tier: 1, getValue: (a) => a.help_audience },
  { key: "agent_vendor", label: "Agent vendor", tier: 1, getValue: agentVendorLabel },
  { key: "multilingual", label: "Multilingual", tier: 1, getValue: multilingualLabel },
  { key: "raw_page_count", label: "Raw page count", tier: 2, getValue: (a) => a.raw_page_count },
  { key: "primary_page_count", label: "Primary page count", tier: 2, getValue: (a) => a.primary_page_count },
  { key: "pass1", label: "Pass 1", tier: 3, getValue: () => null },
  { key: "score", label: "Score", tier: 3, getValue: () => null },
];
