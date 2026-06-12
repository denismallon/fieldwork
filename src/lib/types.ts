import type { Row } from "@libsql/client";

export interface FieldworkTable {
  id: string;
  name: string;
  created_at: number;
}

export interface Account {
  id: string;
  table_id: string;
  company_name: string | null;
  domain: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  job_title: string | null;
  email: string | null;
  email_confidence: string | null;
  employee_count: number | null;
  hq_country: string | null;
  funding_stage: string | null;
  last_funding_date: string | null;
  created_at: number;
}

export type AccountInput = Omit<Account, "id" | "table_id" | "created_at">;

export function rowToAccount(row: Row): Account {
  return {
    id: String(row.id),
    table_id: String(row.table_id),
    company_name: row.company_name === null ? null : String(row.company_name),
    domain: row.domain === null ? null : String(row.domain),
    contact_first_name: row.contact_first_name === null ? null : String(row.contact_first_name),
    contact_last_name: row.contact_last_name === null ? null : String(row.contact_last_name),
    job_title: row.job_title === null ? null : String(row.job_title),
    email: row.email === null ? null : String(row.email),
    email_confidence: row.email_confidence === null ? null : String(row.email_confidence),
    employee_count: row.employee_count === null ? null : Number(row.employee_count),
    hq_country: row.hq_country === null ? null : String(row.hq_country),
    funding_stage: row.funding_stage === null ? null : String(row.funding_stage),
    last_funding_date: row.last_funding_date === null ? null : String(row.last_funding_date),
    created_at: Number(row.created_at),
  };
}
