-- schema.sql — Human-readable schema reference
-- Source of truth is the migration files in db/migrations/
-- This file is updated manually to reflect the current full schema.
-- Current as of: migration 023_structured_hard_reqs

-- Migration tracking (internal)
CREATE TABLE IF NOT EXISTS _migrations (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  filename  TEXT    NOT NULL UNIQUE,
  run_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ─── Settings ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS settings (
  id                           INTEGER PRIMARY KEY CHECK(id = 1),
  pdf_export_path              TEXT,
  crawl_delay_ms               INTEGER NOT NULL DEFAULT 3000,
  posting_retention_days       INTEGER NOT NULL DEFAULT 14,
  profile_entry_word_limit     INTEGER NOT NULL DEFAULT 200,
  log_retention_days           INTEGER NOT NULL DEFAULT 30,
  parse_error_abort_threshold  INTEGER NOT NULL DEFAULT 5,
  affinity_token_budget        INTEGER NOT NULL DEFAULT 80000,
  log_level                    TEXT NOT NULL DEFAULT 'info'
    CHECK(log_level IN ('error', 'warn', 'info', 'debug'))
);

-- ─── User Profile ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_profile (
  id   INTEGER PRIMARY KEY CHECK(id = 1),
  yoe  INTEGER
);

CREATE TABLE IF NOT EXISTS profile_entries (
  id          TEXT PRIMARY KEY,  -- UUID
  type        TEXT NOT NULL
    CHECK(type IN ('experience','credential','accomplishment','skill','education')),
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  tags        TEXT NOT NULL DEFAULT '[]',  -- JSON array
  start_date  TEXT,
  end_date    TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Resumes / Applications ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS applications (
  id              TEXT PRIMARY KEY,  -- UUID
  posting_id      TEXT,              -- FK → job_postings.id (nullable)
  tex_path        TEXT NOT NULL,     -- Absolute path to .typ file
  resume_json     TEXT NOT NULL,     -- JSON snapshot of ResumeData for recompile
  schema_version  INTEGER NOT NULL DEFAULT 1,
  applied_at      TEXT,              -- ISO timestamp; NULL until user applies
  notes           TEXT,
  name            TEXT,              -- User-defined display label
  template_name   TEXT NOT NULL DEFAULT 'classic'  -- Typst template used
);

-- ─── Search Configuration ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS search_config (
  id                      INTEGER PRIMARY KEY CHECK(id = 1),
  intent                  TEXT,
  term_generation_hash    TEXT,
  ranking_weights         TEXT NOT NULL DEFAULT '{}',           -- JSON: Record<string, number>
  affinity_skip_threshold INTEGER NOT NULL DEFAULT 15,
  excluded_stack          TEXT NOT NULL DEFAULT '[]',           -- JSON: string[]
  required_keywords       TEXT NOT NULL DEFAULT '[]',           -- JSON: string[]
  excluded_keywords       TEXT NOT NULL DEFAULT '[]',           -- JSON: string[]
  keyword_match_fields    TEXT NOT NULL DEFAULT '["title","tech_stack"]'  -- JSON: string[]
);

CREATE TABLE IF NOT EXISTS search_terms (
  id          TEXT PRIMARY KEY,  -- UUID
  term        TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  source      TEXT NOT NULL CHECK(source IN ('llm_generated', 'user_added')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  recency     TEXT CHECK(recency IN ('day', 'week', 'month')),
  max_results INTEGER,
  locations   TEXT,    -- JSON array of city/region strings
  seniorities TEXT,    -- JSON array of 'intern'|'junior'|'mid'|'senior'|'staff'
  work_type   TEXT     -- JSON array of 'remote'|'hybrid'|'onsite'
);

-- ─── Ban List ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ban_list (
  id          TEXT PRIMARY KEY,  -- UUID
  type        TEXT NOT NULL CHECK(type IN ('company', 'domain')),
  value       TEXT NOT NULL,     -- Regex pattern (company) or exact hostname (domain)
  reason      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Job Postings ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS job_postings (
  id                  TEXT PRIMARY KEY,  -- UUID
  source              TEXT NOT NULL,
  url                 TEXT NOT NULL,
  resolved_domain     TEXT,
  title               TEXT NOT NULL,
  company             TEXT NOT NULL,
  location            TEXT NOT NULL DEFAULT '',
  yoe_min             INTEGER,
  yoe_max             INTEGER,
  seniority           TEXT NOT NULL DEFAULT 'any'
    CHECK(seniority IN ('intern', 'junior', 'mid', 'senior', 'staff', 'any')),
  tech_stack          TEXT NOT NULL DEFAULT '[]',  -- JSON array
  posted_at           TEXT,
  applicant_count     INTEGER,
  raw_text            TEXT,
  fetched_at          TEXT NOT NULL,
  scraper_mod_version TEXT NOT NULL DEFAULT '',
  status              TEXT NOT NULL DEFAULT 'new'
    CHECK(status IN ('new', 'viewed', 'favorited', 'applied', 'interviewing', 'offer', 'rejected', 'ghosted')),
  affinity_score      REAL,
  affinity_skipped    INTEGER NOT NULL DEFAULT 0,
  affinity_scored_at  TEXT,
  affinity_reasoning  TEXT,
  description_snippet TEXT,        -- verbatim ~400-char role-summary excerpt from raw_text (extracted by scoring LLM)
  first_response_at   TEXT,
  last_seen_at        TEXT NOT NULL,
  salary_min          INTEGER,    -- annual USD
  salary_max          INTEGER,    -- annual USD
  company_rating      REAL,       -- 1.0–5.0 Glassdoor star rating
  applied_at          TEXT,       -- set when status transitions to 'applied'
  hard_reqs_class     TEXT
    CHECK(hard_reqs_class IN ('overqualified','fully_qualified','minimally_qualified','underqualified')),
  nice_to_haves_class TEXT
    CHECK(nice_to_haves_class IN ('fully_met','partially_met','not_met')),
  hard_reqs_struct    TEXT,      -- JSON; structured hard requirements emitted by scoring LLM, evaluated deterministically by core/jobs/hardReqs.ts
  archived_at         TEXT       -- non-null = hidden from default JobBoard (auto-set by retention sweep)
);

CREATE INDEX IF NOT EXISTS idx_job_postings_archived_at ON job_postings(archived_at);

-- ─── LLM Usage ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS llm_usage (
  id              TEXT PRIMARY KEY,  -- UUID
  call_type       TEXT NOT NULL
    CHECK(call_type IN ('search_term_gen', 'affinity_scoring', 'resume_tailoring')),
  model           TEXT NOT NULL,
  input_tokens    INTEGER NOT NULL,
  output_tokens   INTEGER NOT NULL,
  estimated_cost  REAL NOT NULL,
  called_at       TEXT NOT NULL DEFAULT (datetime('now')),
  posting_id      TEXT  -- FK → job_postings.id; NULL for search_term_gen
);
