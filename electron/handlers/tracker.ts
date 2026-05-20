import { ipcMain } from 'electron'
import { getDb } from '../../db/database'
import { getTrackerPostings } from '../../core/tracker/repository'
import { rowToPosting, type JobPostingRow } from '../../core/jobs/adapters/base'
import { logger } from '../logger'

interface TrackerArchivedRow extends JobPostingRow {
  applied_at: string | null
}

export function registerTrackerHandlers(): void {
  ipcMain.handle('tracker:get-postings', () => {
    return getTrackerPostings(getDb())
  })

  ipcMain.handle('tracker:list-archived', () => {
    const rows = getDb()
      .prepare(
        `SELECT * FROM job_postings
         WHERE status NOT IN ('new', 'viewed')
           AND archived_at IS NOT NULL
         ORDER BY archived_at DESC`,
      )
      .all() as TrackerArchivedRow[]
    return rows.map((row) => ({ ...rowToPosting(row), applied_at: row.applied_at ?? null }))
  })

  ipcMain.handle('tracker:archived-count', () => {
    const row = getDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM job_postings
         WHERE status NOT IN ('new', 'viewed')
           AND archived_at IS NOT NULL`,
      )
      .get() as { n: number }
    return row.n
  })

  ipcMain.handle('tracker:delete-all-archived', () => {
    const result = getDb()
      .prepare(
        `DELETE FROM job_postings
          WHERE status NOT IN ('new', 'viewed')
            AND archived_at IS NOT NULL`,
      )
      .run()
    logger.info('Deleted archived tracker postings', { count: result.changes })
    return result.changes
  })
}
