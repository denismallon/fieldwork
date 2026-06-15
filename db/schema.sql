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
  help_centre_url TEXT,
  help_centre_url_status TEXT, -- 'found' | 'not_found'
  platform TEXT,
  help_audience TEXT, -- 'non-technical' | 'technical' | 'unknown'
  agent_vendor TEXT, -- comma-separated if multiple, or 'none'
  multilingual INTEGER, -- 0 | 1
  detected_languages TEXT, -- JSON: ["en","fr"] after Tier 1, {"en":200,"fr":150} after Tier 2
  requires_login INTEGER, -- 0 | 1 | NULL (unknown)
  raw_page_count INTEGER,
  primary_page_count INTEGER,
  page_count_status TEXT, -- 'found' | 'not_found'
  changelog_url TEXT,
  release_velocity TEXT, -- 'high' | 'medium' | 'low' | 'unknown'
  release_velocity_source TEXT, -- 'dedicated_tool' | 'rss' | 'blog' | 'unknown'
  freshness_signal TEXT, -- 'fresh' | 'stale' | 'very_stale' | 'unknown'
  freshness_confidence TEXT, -- 'high' | 'medium' | 'low' | 'unmeasurable'
  freshness_source TEXT, -- 'in_content' | 'sitemap_lastmod' | 'http_header' | 'unknown'
  pass1 INTEGER, -- 1 (pass) | 0 (fail) | NULL (insufficient data)
  score INTEGER, -- 0-100 | NULL (pass1 not met or data insufficient)
  score_confidence TEXT, -- 'high' | 'medium' | 'low'
  score_flags TEXT, -- JSON array of human-review warning strings
  tier1_enriched_at INTEGER,
  tier2_enriched_at INTEGER,
  tier3_enriched_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_accounts_table_id ON accounts(table_id);
CREATE INDEX IF NOT EXISTS idx_accounts_table_domain ON accounts(table_id, domain);
