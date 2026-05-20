import Database from 'better-sqlite3'
import type {
  FunnelSummary,
  SourceMetric,
  SeniorityMetric,
  WeeklyMetric,
  LLMCostSummary,
  LLMCostByType,
} from '../../src/shared/ipc-types'

// ─── Application funnel ───────────────────────────────────────────────────────

export function getFunnelSummary(db: Database.Database): FunnelSummary {
  const rows = db
    .prepare(
      `SELECT status, COUNT(*) AS count
       FROM job_postings
       WHERE status IN ('applied','interviewing','offer','rejected','ghosted')
       GROUP BY status`,
    )
    .all() as { status: string; count: number }[]

  const counts: Record<string, number> = {}
  for (const r of rows) counts[r.status] = r.count

  const applied = counts['applied'] ?? 0
  const interviewing = counts['interviewing'] ?? 0
  const offer = counts['offer'] ?? 0
  const rejected = counts['rejected'] ?? 0
  const ghosted = counts['ghosted'] ?? 0

  const responded = interviewing + offer + rejected
  const response_rate = applied > 0 ? responded / applied : 0
  const conversion_rate = applied > 0 ? offer / applied : 0

  return { applied, interviewing, offer, rejected, ghosted, response_rate, conversion_rate }
}

// ─── By source ────────────────────────────────────────────────────────────────

export function getBySource(db: Database.Database): SourceMetric[] {
  const rows = db
    .prepare(
      `SELECT
         jp.source AS source,
         COUNT(DISTINCT jp.id) AS count,
         COUNT(DISTINCT CASE WHEN jp.status IN ('interviewing','offer','rejected') THEN jp.id END) AS responded,
         AVG(
           CASE
             WHEN jp.first_response_at IS NOT NULL AND a.applied_at IS NOT NULL
             THEN CAST((julianday(jp.first_response_at) - julianday(a.applied_at)) AS REAL)
             ELSE NULL
           END
         ) AS avg_days
       FROM job_postings jp
       LEFT JOIN applications a ON a.posting_id = jp.id
       WHERE jp.status IN ('applied','interviewing','offer','rejected','ghosted')
       GROUP BY jp.source`,
    )
    .all() as { source: string; count: number; responded: number; avg_days: number | null }[]

  return rows.map((r) => ({
    source: r.source,
    count: r.count,
    response_rate: r.count > 0 ? r.responded / r.count : 0,
    avg_days_to_response: r.avg_days,
  }))
}

// ─── By seniority ─────────────────────────────────────────────────────────────

export function getBySeniority(db: Database.Database): SeniorityMetric[] {
  const rows = db
    .prepare(
      `SELECT
         seniority,
         COUNT(*) AS count,
         SUM(CASE WHEN status IN ('interviewing','offer','rejected') THEN 1 ELSE 0 END) AS responded
       FROM job_postings
       WHERE status IN ('applied','interviewing','offer','rejected','ghosted')
       GROUP BY seniority`,
    )
    .all() as { seniority: string; count: number; responded: number }[]

  return rows.map((r) => ({
    seniority: r.seniority,
    count: r.count,
    response_rate: r.count > 0 ? r.responded / r.count : 0,
  }))
}

// ─── Weekly time series ───────────────────────────────────────────────────────

export function getWeeklyTimeSeries(db: Database.Database, weeks = 12): WeeklyMetric[] {
  // SQLite: strftime('%Y-W%W', applied_at) gives ISO-like week
  const rows = db
    .prepare(
      `SELECT
         strftime('%Y-W%W', a.applied_at) AS week,
         COUNT(*) AS applications
       FROM applications a
       WHERE a.applied_at IS NOT NULL
         AND a.applied_at >= date('now', ?)
       GROUP BY week
       ORDER BY week ASC`,
    )
    .all(`-${weeks * 7} days`) as { week: string; applications: number }[]

  return rows.map((r) => ({ week: r.week, applications: r.applications }))
}

// ─── LLM cost ─────────────────────────────────────────────────────────────────

export function getLLMCostSummary(db: Database.Database): LLMCostSummary {
  const allTime = (
    db.prepare(`SELECT COALESCE(SUM(estimated_cost), 0) AS total FROM llm_usage`).get() as {
      total: number
    }
  ).total

  const currentMonth = (
    db
      .prepare(
        `SELECT COALESCE(SUM(estimated_cost), 0) AS total
         FROM llm_usage
         WHERE strftime('%Y-%m', called_at) = strftime('%Y-%m', 'now')`,
      )
      .get() as { total: number }
  ).total

  return { all_time: allTime, current_month: currentMonth }
}

export function getLLMCostByType(db: Database.Database): LLMCostByType[] {
  return db
    .prepare(
      `SELECT call_type, SUM(estimated_cost) AS total_cost, COUNT(*) AS call_count
       FROM llm_usage
       GROUP BY call_type`,
    )
    .all() as LLMCostByType[]
}
