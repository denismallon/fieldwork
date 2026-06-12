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

/** Placeholder enrichment column headers (no data yet). */
export const ENRICHMENT_COLUMNS = [
  "Help centre URL",
  "Platform",
  "Help audience",
  "Agent vendor",
  "Multilingual",
  "Raw page count",
  "Primary page count",
  "Pass 1",
  "Score",
];
