/**
 * Test stubs for IPC handlers that invoke Claude.
 * This module is imported by electron/main.ts when APP_TEST=1.
 * It replaces Claude-dependent handlers with deterministic fixture responses.
 */

import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import path from 'path'
import fs from 'fs'
import { getDb } from '../db/database'
import { STUB_SEARCH_TERMS, STUB_RESUME_DATA, STUB_PDF_IMPORT_ENTRIES, stubAffinityScore } from '../tests/e2e/fixtures/claude-stubs'
import type { SearchTerm, GenConstraints, Recency } from '../src/shared/ipc-types'
import { renderTyp } from '../core/resume/renderer'
import { compileTyp } from '../core/resume/compiler'
import { pdfPathToUrl } from '../core/resume/previewer'
import { app } from 'electron'
import { runScrape } from '../core/jobs/aggregator'
import { MockAdapter } from '../core/jobs/adapters/mock'
import { getFilteredRankedPostings } from '../core/jobs/ranker'

function insertStubTermsWithConstraints(constraints?: GenConstraints): SearchTerm[] {
  const db = getDb()
  const now = new Date().toISOString()

  db.prepare("DELETE FROM search_terms WHERE source = 'llm_generated'").run()

  const inserted: SearchTerm[] = []
  for (const t of STUB_SEARCH_TERMS) {
    const id = randomUUID()
    const locations = constraints?.locations?.length ? JSON.stringify(constraints.locations) : null
    const seniorities = constraints?.seniorities?.length ? JSON.stringify(constraints.seniorities) : null
    const work_type = constraints?.work_type?.length ? JSON.stringify(constraints.work_type) : null
    const recency = constraints?.recency ?? null
    const max_results = constraints?.max_results ?? null
    db.prepare(
      `INSERT INTO search_terms (id, term, enabled, source, created_at, locations, seniorities, work_type, recency, max_results)
       VALUES (?, ?, 1, 'llm_generated', ?, ?, ?, ?, ?, ?)`,
    ).run(id, t.term, now, locations, seniorities, work_type, recency, max_results)
    inserted.push({
      ...t,
      id,
      created_at: now,
      locations: constraints?.locations ?? null,
      seniorities: constraints?.seniorities ?? null,
      work_type: constraints?.work_type ?? null,
      recency: recency as Recency | null,
      max_results,
    })
  }
  return inserted
}

export function registerTestStubs(): void {
  // ─── Scrape — add a small delay so the 'Running…' UI state is observable ────
  ipcMain.removeHandler('jobs:run-scrape')
  ipcMain.handle('jobs:run-scrape', async (event) => {
    await new Promise((resolve) => setTimeout(resolve, 500))
    await runScrape(
      getDb(),
      [new MockAdapter()],
      undefined,
      undefined,
      (posting) => { event.sender.send('jobs:posting-committed', posting) },
    )
    event.sender.send('jobs:scrape-committed')
  })

  // ─── Search term generation ─────────────────────────────────────────────────
  // Override: return deterministic AI-suggested terms without calling Claude.
  // Constraints are applied so tests can verify the full constraint flow.
  ipcMain.removeHandler('search-terms:generate')
  ipcMain.handle('search-terms:generate', (_event, constraints?: GenConstraints) => {
    return insertStubTermsWithConstraints(constraints)
  })

  // ─── Search term generation from profile ────────────────────────────────────
  ipcMain.removeHandler('search-terms:generate-from-profile')
  ipcMain.handle('search-terms:generate-from-profile', (_event, constraints?: GenConstraints) => {
    return insertStubTermsWithConstraints(constraints)
  })

  // ─── Affinity scoring (ranker) ──────────────────────────────────────────────
  // The ranker calls Claude internally. In test mode, pre-populate affinity
  // scores directly in the DB so the ranker skips the Claude call entirely.
  // We do this by overriding `jobs:run-scrape` post-processing to stamp scores.
  // Simpler approach: after a scrape commit, a one-off IPC to seed scores.
  // The cleanest seam: override jobs:get-postings to stamp scores if absent.
  ipcMain.removeHandler('jobs:get-postings')
  ipcMain.handle('jobs:get-postings', () => {
    const db = getDb()

    // Stamp stub affinity scores for any unscored postings
    const unscored = db
      .prepare("SELECT id FROM job_postings WHERE affinity_score IS NULL AND status != 'archived'")
      .all() as { id: string }[]

    if (unscored.length > 0) {
      const now = new Date().toISOString()
      const update = db.prepare(
        `UPDATE job_postings
         SET affinity_score = ?, affinity_reasoning = ?, description_snippet = ?, affinity_scored_at = ?,
             affinity_skipped = 0, hard_reqs_class = ?, nice_to_haves_class = ?
         WHERE id = ?`,
      )
      for (const { id } of unscored) {
        const scored = stubAffinityScore(id)
        update.run(scored.affinity_score, scored.reasoning, scored.description_snippet, now, scored.hard_reqs_class, scored.nice_to_haves_class, id)
      }
    }

    // Now delegate to the real ranking logic.
    // Since we've already stamped scores, the ranker won't call Claude.
    return getFilteredRankedPostings(db)
  })

  // ─── Resume tailoring ───────────────────────────────────────────────────────
  // Override: return a pre-built resume without calling Claude.
  ipcMain.removeHandler('resume:tailor')
  ipcMain.handle('resume:tailor', async (_event, payload: unknown) => {
    const { templateName, postingId } = payload as {
      templateName: string
      postingId?: string
    }

    const applicationId = randomUUID()
    const userData = app.getPath('userData')
    const typDir = path.join(userData, 'resumes', applicationId)
    const typPath = path.join(typDir, 'resume.typ')

    renderTyp(templateName ?? 'classic', STUB_RESUME_DATA as never, typPath)

    // Attempt real compilation; if typst absent, return a placeholder PDF URL
    let pdfUrl = `file://${typPath.replace('.typ', '.pdf')}`
    try {
      const outcome = await compileTyp(typPath, 'typst')
      if (outcome.success) pdfUrl = pdfPathToUrl(outcome.pdfPath)
    } catch {
      // typst not available in CI — return stub path; preview test checks iframe src
    }

    const application = {
      id: applicationId,
      posting_id: postingId ?? null,
      tex_path: typPath,
      resume_json: JSON.stringify(STUB_RESUME_DATA),
      schema_version: 1,
      applied_at: new Date().toISOString(),
      notes: '',
    }

    getDb()
      .prepare(
        `INSERT INTO applications (id, posting_id, tex_path, resume_json, schema_version, applied_at, notes)
         VALUES (@id, @posting_id, @tex_path, @resume_json, @schema_version, @applied_at, @notes)`,
      )
      .run(application)

    return { application, pdfUrl }
  })

  // ─── Dialog stubs for file operations ──────────────────────────────────────
  // Override backup and data export to write to a predictable temp path
  // so tests can assert a file was created without OS dialog interaction.
  const tmpDir = app.getPath('temp')

  ipcMain.removeHandler('backup:create')
  ipcMain.handle('backup:create', () => {
    const dbPath = path.join(app.getPath('userData'), 'jobhunt.db')
    const dest = path.join(tmpDir, `careerindex-test-backup-${Date.now()}.db`)
    if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, dest)
    return dest
  })

  // ─── Direct-path import (test-only) ───────────────────────────────────────
  // Allows tests to import from a specific file path without the OS open dialog.
  ipcMain.removeHandler('data:import-file')
  ipcMain.handle('data:import-file', (_event, { mode, filePath }: { mode: 'merge' | 'replace'; filePath: string }) => {
    const db = getDb()
    const raw = fs.readFileSync(filePath, 'utf-8')
    let payload: Record<string, unknown>
    try { payload = JSON.parse(raw) } catch { throw new Error('Invalid JSON file') }
    let imported = 0
    db.transaction(() => {
      if (mode === 'replace') {
        db.prepare('DELETE FROM profile_entries').run()
        db.prepare('DELETE FROM search_terms').run()
        db.prepare('DELETE FROM ban_list').run()
      }
      if (Array.isArray(payload.profile_entries)) {
        const stmt = db.prepare(
          `INSERT OR IGNORE INTO profile_entries (id, type, title, content, tags, start_date, end_date, created_at)
           VALUES (@id, @type, @title, @content, @tags, @start_date, @end_date, @created_at)`,
        )
        for (const e of payload.profile_entries as Record<string, unknown>[]) {
          if (e.id && e.type && e.title && e.content) { stmt.run(e); imported++ }
        }
      }
    })()
    return { imported }
  })

  ipcMain.removeHandler('data:export')
  ipcMain.handle('data:export', () => {
    const db = getDb()
    const payload = {
      version: 1,
      exported_at: new Date().toISOString(),
      profile_entries: db.prepare('SELECT * FROM profile_entries').all(),
      search_config: db.prepare('SELECT * FROM search_config WHERE id = 1').get(),
      search_terms: db.prepare('SELECT * FROM search_terms').all(),
      ban_list: db.prepare('SELECT * FROM ban_list').all(),
    }
    const dest = path.join(tmpDir, `careerindex-test-export-${Date.now()}.json`)
    fs.writeFileSync(dest, JSON.stringify(payload, null, 2), 'utf-8')
    return dest
  })

  // ─── External URL stub ─────────────────────────────────────────────────────
  // Prevent real xdg-open/browser spawn during tests — those processes outlive
  // Electron's app.quit() and cause "Tearing down 'app' exceeded the test
  // timeout" failures.
  ipcMain.removeHandler('shell:open-external')
  ipcMain.handle('shell:open-external', () => {})

  // ─── Archive test helpers ───────────────────────────────────────────────────
  // Tests need to seed archived_at + manipulate fetched_at without restarting the
  // app. These handlers are only registered under APP_TEST=1.

  ipcMain.handle('test:archive-oldest', (_event, n: number) => {
    const db = getDb()
    const rows = db
      .prepare(`SELECT id FROM job_postings ORDER BY fetched_at ASC LIMIT ?`)
      .all(n) as { id: string }[]
    const stmt = db.prepare(`UPDATE job_postings SET archived_at = datetime('now') WHERE id = ?`)
    for (const r of rows) stmt.run(r.id)
    return rows.map((r) => r.id)
  })

  ipcMain.handle(
    'test:backdate-postings',
    (_event, { ids, status }: { ids: string[]; status: string }) => {
      const db = getDb()
      const stmt = db.prepare(
        `UPDATE job_postings SET fetched_at = datetime('now', '-365 days'), status = ? WHERE id = ?`,
      )
      for (const id of ids) stmt.run(status, id)
    },
  )

  ipcMain.handle('test:run-archive-sweep', (_event, retentionDays: number) => {
    const result = getDb()
      .prepare(
        `UPDATE job_postings
            SET archived_at = COALESCE(archived_at, datetime('now')),
                raw_text = NULL
          WHERE status IN ('new', 'viewed')
            AND archived_at IS NULL
            AND fetched_at < date('now', '-' || ? || ' days')`,
      )
      .run(retentionDays)
    return result.changes
  })

  ipcMain.handle('test:archive-favorited', () => {
    getDb()
      .prepare(`UPDATE job_postings SET archived_at = datetime('now') WHERE status = 'favorited'`)
      .run()
  })

  ipcMain.handle('test:count-archived', () => {
    const row = getDb()
      .prepare(`SELECT COUNT(*) AS n FROM job_postings WHERE archived_at IS NOT NULL`)
      .get() as { n: number }
    return row.n
  })

  ipcMain.handle('test:get-all-posting-ids', () => {
    const rows = getDb().prepare(`SELECT id FROM job_postings`).all() as { id: string }[]
    return rows.map((r) => r.id)
  })

  ipcMain.handle('test:get-raw-text', (_event, id: string) => {
    const row = getDb()
      .prepare(`SELECT raw_text FROM job_postings WHERE id = ?`)
      .get(id) as { raw_text: string | null } | undefined
    return row?.raw_text ?? null
  })

  // ─── Resume PDF import stub ─────────────────────────────────────────────────
  // Bypass file dialog + Claude call; insert deterministic fixture entries.
  ipcMain.removeHandler('profile:import-resume-pdf')
  ipcMain.handle('profile:import-resume-pdf', () => {
    const db = getDb()
    const now = new Date().toISOString()
    const inserted = []
    const stmt = db.prepare(
      `INSERT INTO profile_entries (id, type, title, content, tags, start_date, end_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const entry of STUB_PDF_IMPORT_ENTRIES) {
      const id = randomUUID()
      stmt.run(id, entry.type, entry.title, entry.content, JSON.stringify(entry.tags), entry.start_date, entry.end_date, now)
      inserted.push({ ...entry, id, created_at: now })
    }
    return { added: inserted.length, entries: inserted }
  })
}
