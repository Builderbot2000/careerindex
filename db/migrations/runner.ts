import Database from 'better-sqlite3'
import sql001 from './001_initial.sql?raw'
import sql002 from './002_profile.sql?raw'
import sql003 from './003_resume.sql?raw'
import sql004 from './004_jobs.sql?raw'
import sql005 from './005_safe_storage.sql?raw'
import sql006 from './006_llm_usage.sql?raw'
import sql007 from './007_affinity_reasoning.sql?raw'
import sql008 from './008_applications_nullable_applied_at.sql?raw'
import sql009 from './009_search_term_conditions.sql?raw'
import sql010 from './010_search_terms_drop_adapter_id.sql?raw'
import sql011 from './011_applications_name.sql?raw'
import sql012 from './012_search_terms_multiselect.sql?raw'
import sql013 from './013_salary_company_rating.sql?raw'
import sql014 from './014_typst.sql?raw'
import sql015 from './015_job_postings_applied_at.sql?raw'
import sql016 from './016_affinity_classes.sql?raw'
import sql017 from './017_clear_affinity_skipped.sql?raw'
import sql018 from './018_applications_template_name.sql?raw'
import sql019 from './019_user_qualifications.sql?raw'
import sql020 from './020_qualifications_v2.sql?raw'
import sql021 from './021_job_postings_archived_at.sql?raw'
import sql022 from './022_job_postings_description_snippet.sql?raw'
import sql023 from './023_structured_hard_reqs.sql?raw'
import sql024 from './024_posting_required_seniorities.sql?raw'

interface MigrationRecord {
  filename: string
}

const MIGRATIONS: ReadonlyArray<{ filename: string; sql: string }> = [
  { filename: '001_initial.sql', sql: sql001 },
  { filename: '002_profile.sql', sql: sql002 },
  { filename: '003_resume.sql', sql: sql003 },
  { filename: '004_jobs.sql', sql: sql004 },
  { filename: '005_safe_storage.sql', sql: sql005 },
  { filename: '006_llm_usage.sql', sql: sql006 },
  { filename: '007_affinity_reasoning.sql', sql: sql007 },
  { filename: '008_applications_nullable_applied_at.sql', sql: sql008 },
  { filename: '009_search_term_conditions.sql', sql: sql009 },
  { filename: '010_search_terms_drop_adapter_id.sql', sql: sql010 },
  { filename: '011_applications_name.sql', sql: sql011 },
  { filename: '012_search_terms_multiselect.sql', sql: sql012 },
  { filename: '013_salary_company_rating.sql', sql: sql013 },
  { filename: '014_typst.sql', sql: sql014 },
  { filename: '015_job_postings_applied_at.sql', sql: sql015 },
  { filename: '016_affinity_classes.sql', sql: sql016 },
  { filename: '017_clear_affinity_skipped.sql', sql: sql017 },
  { filename: '018_applications_template_name.sql', sql: sql018 },
  { filename: '019_user_qualifications.sql', sql: sql019 },
  { filename: '020_qualifications_v2.sql', sql: sql020 },
  { filename: '021_job_postings_archived_at.sql', sql: sql021 },
  { filename: '022_job_postings_description_snippet.sql', sql: sql022 },
  { filename: '023_structured_hard_reqs.sql', sql: sql023 },
  { filename: '024_posting_required_seniorities.sql', sql: sql024 },
]

export function runMigrations(
  db: Database.Database,
  log: (msg: string) => void = console.log,
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      filename  TEXT    NOT NULL UNIQUE,
      run_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `)

  const ran = new Set(
    (db.prepare('SELECT filename FROM _migrations').all() as MigrationRecord[]).map(
      (r) => r.filename,
    ),
  )

  for (const { filename, sql } of MIGRATIONS) {
    if (ran.has(filename)) continue

    log(`Running migration: ${filename}`)
    const apply = db.transaction(() => {
      db.exec(sql)
      db.prepare('INSERT INTO _migrations (filename) VALUES (?)').run(filename)
    })
    apply()
    log(`Migration complete: ${filename}`)
  }
}
