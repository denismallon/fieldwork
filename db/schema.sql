-- Fieldwork database schema (Turso / SQLite)

CREATE TABLE IF NOT EXISTS magic_link_tokens (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_token ON magic_link_tokens(token);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS fieldwork_tables (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL REFERENCES fieldwork_tables(id),
  company_name TEXT,
  domain TEXT,
  contact_first_name TEXT,
  contact_last_name TEXT,
  job_title TEXT,
  email TEXT,
  email_confidence TEXT,
  employee_count INTEGER,
  hq_country TEXT,
  funding_stage TEXT,
  last_funding_date TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_accounts_table_id ON accounts(table_id);
CREATE INDEX IF NOT EXISTS idx_accounts_table_domain ON accounts(table_id, domain);
