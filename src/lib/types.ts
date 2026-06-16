import type { Row } from "@libsql/client";

export interface FieldworkTable {
  id: string;
  name: string;
  created_at: number;
}

export interface EnrichmentFields {
  help_centre_url: string | null;
  help_centre_url_status: string | null;
  platform: string | null;
  help_audience: string | null;
  agent_vendor: string | null;
  multilingual: number | null;
  detected_languages: string | null;
  requires_login: number | null;
  raw_page_count: number | null;
  primary_page_count: number | null;
  page_count_status: string | null;
  changelog_url: string | null;
  changelog_type: string | null;
  changelog_candidates: string | null;
  release_velocity: string | null;
  freshness_signal: string | null;
  freshness_confidence: string | null;
  tier3_rationale: string | null;
  pass1: number | null;
  score: number | null;
  score_confidence: string | null;
  score_flags: string | null;
  tier1_enriched_at: number | null;
  tier2_enriched_at: number | null;
  tier3_enriched_at: number | null;
}

export interface Account extends EnrichmentFields {
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

export type AccountInput = Omit<Account, "id" | "table_id" | "created_at" | keyof EnrichmentFields>;

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
    help_centre_url: row.help_centre_url === null ? null : String(row.help_centre_url),
    help_centre_url_status:
      row.help_centre_url_status === null ? null : String(row.help_centre_url_status),
    platform: row.platform === null ? null : String(row.platform),
    help_audience: row.help_audience === null ? null : String(row.help_audience),
    agent_vendor: row.agent_vendor === null ? null : String(row.agent_vendor),
    multilingual: row.multilingual === null ? null : Number(row.multilingual),
    detected_languages: row.detected_languages === null ? null : String(row.detected_languages),
    requires_login: row.requires_login === null ? null : Number(row.requires_login),
    raw_page_count: row.raw_page_count === null ? null : Number(row.raw_page_count),
    primary_page_count: row.primary_page_count === null ? null : Number(row.primary_page_count),
    page_count_status: row.page_count_status === null ? null : String(row.page_count_status),
    changelog_url: row.changelog_url === null ? null : String(row.changelog_url),
    changelog_type: row.changelog_type === null ? null : String(row.changelog_type),
    changelog_candidates: row.changelog_candidates === null ? null : String(row.changelog_candidates),
    release_velocity: row.release_velocity === null ? null : String(row.release_velocity),
    freshness_signal: row.freshness_signal === null ? null : String(row.freshness_signal),
    freshness_confidence: row.freshness_confidence === null ? null : String(row.freshness_confidence),
    tier3_rationale: row.tier3_rationale == null ? null : String(row.tier3_rationale),
    pass1: row.pass1 === null ? null : Number(row.pass1),
    score: row.score === null ? null : Number(row.score),
    score_confidence: row.score_confidence === null ? null : String(row.score_confidence),
    score_flags: row.score_flags === null ? null : String(row.score_flags),
    tier1_enriched_at: row.tier1_enriched_at === null ? null : Number(row.tier1_enriched_at),
    tier2_enriched_at: row.tier2_enriched_at === null ? null : Number(row.tier2_enriched_at),
    tier3_enriched_at: row.tier3_enriched_at === null ? null : Number(row.tier3_enriched_at),
    created_at: Number(row.created_at),
  };
}
