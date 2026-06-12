import type { AccountInput } from "./types";

/** Strips the protocol and trailing slashes from an Apollo "Website" value. */
export function normalizeDomain(website: string): string {
  return website
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

/** Maps a single row of an Apollo CSV export to the internal account fields. */
export function mapApolloRow(row: Record<string, string>): AccountInput {
  const get = (header: string) => row[header]?.trim() || "";

  const website = get("Website");
  const employeeCountRaw = get("# Employees");
  const employeeCount = employeeCountRaw ? parseInt(employeeCountRaw, 10) : NaN;

  return {
    company_name: get("Company") || null,
    domain: website ? normalizeDomain(website) : null,
    contact_first_name: get("First Name") || null,
    contact_last_name: get("Last Name") || null,
    job_title: get("Title") || null,
    email: get("Email") || null,
    email_confidence: get("Email Status") || null,
    employee_count: Number.isFinite(employeeCount) ? employeeCount : null,
    hq_country: get("Country") || null,
    funding_stage: get("Latest Funding") || null,
    last_funding_date: get("Latest Funding Date") || null,
  };
}

/** Escapes a single CSV field value. */
export function csvField(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Joins fields into a single CSV row (CRLF terminated). */
export function csvRow(fields: (string | number | null | undefined)[]): string {
  return fields.map(csvField).join(",") + "\r\n";
}
