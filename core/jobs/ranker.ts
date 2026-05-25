import Database from 'better-sqlite3'
import { rowToPosting } from './adapters/base'
import type { JobPosting, JobPostingRow } from './adapters/base'
import { scorePostings } from './scorer'
import type { QuotaErrorCallback } from '../llm/withQuotaGuard'
import { computeYoeFromEntries } from '../profile/yoe'
import { getAllEntries } from '../profile/repository'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

function parseWeights(raw: string | null | undefined): Record<string, number> {
  if (!raw) return {}
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, number>) : {}
  } catch {
    return {}
  }
}

// ─── Stage 1 — Hard filters ───────────────────────────────────────────────────

function applyHardFilters(
  postings: JobPosting[],
  config: {
    required_keywords: string[]
    excluded_keywords: string[]
    keyword_match_fields: string[]
    excluded_stack: string[]
  },
  userYoe: number,
): JobPosting[] {
  return postings.filter((p) => {
    // 1a — keyword filter
    const fields: string[] = [p.company]  // company always searched
    if (config.keyword_match_fields.includes('title')) fields.push(p.title)
    if (config.keyword_match_fields.includes('tech_stack')) fields.push(...p.tech_stack)
    if (config.keyword_match_fields.includes('raw_text') && p.raw_text) fields.push(p.raw_text)
    const haystack = fields.join(' ').toLowerCase()

    if (config.excluded_keywords.length > 0) {
      for (const kw of config.excluded_keywords) {
        const pattern = kw.startsWith('re:') ? new RegExp(kw.slice(3), 'i') : kw.toLowerCase()
        if (typeof pattern === 'string' ? haystack.includes(pattern) : pattern.test(haystack)) {
          return false
        }
      }
    }

    if (config.required_keywords.length > 0) {
      const matchesRequired = config.required_keywords.some((kw) => {
        const pattern = kw.startsWith('re:') ? new RegExp(kw.slice(3), 'i') : kw.toLowerCase()
        return typeof pattern === 'string' ? haystack.includes(pattern) : pattern.test(haystack)
      })
      if (!matchesRequired) return false
    }

    // 1b — YOE filter (computed from experience entries)
    if (p.yoe_min !== null && userYoe < p.yoe_min) return false
    if (p.yoe_max !== null && userYoe > p.yoe_max) return false

    // 1c — excluded stack
    if (config.excluded_stack.length > 0) {
      const stackLower = p.tech_stack.map((s) => s.toLowerCase())
      if (config.excluded_stack.some((ex) => stackLower.includes(ex.toLowerCase()))) {
        return false
      }
    }

    return true
  })
}

// ─── Stage 3 — Composite score ────────────────────────────────────────────────

function compositeScore(
  posting: JobPosting,
  weights: Record<string, number>,
  now: number,
): number {
  const scores: Array<{ signal: string; value: number }> = []

  // Recency: decay from 1.0 at 0 days to 0.0 at 60 days
  const dateStr = posting.posted_at ?? posting.fetched_at
  const ageDays = (now - new Date(dateStr).getTime()) / 86_400_000
  scores.push({ signal: 'recency', value: Math.max(0, 1 - ageDays / 60) })

  // Affinity (only if scored and not skipped)
  if (posting.affinity_score !== null && !posting.affinity_skipped) {
    scores.push({ signal: 'affinity', value: posting.affinity_score })
  }

  // Applicant count (lower is better; normalize to 0–1 with 500 as ceiling)
  if (posting.applicant_count !== null) {
    scores.push({
      signal: 'applicant_count',
      value: Math.max(0, 1 - posting.applicant_count / 500),
    })
  }

  if (scores.length === 0) return 0

  let weightedSum = 0
  let weightTotal = 0
  for (const { signal, value } of scores) {
    const w = weights[signal] ?? (signal === 'affinity' ? 0.6 : signal === 'recency' ? 0.4 : 0.2)
    weightedSum += w * value
    weightTotal += w
  }

  return weightTotal > 0 ? weightedSum / weightTotal : 0
}

// ─── Shared config loader ────────────────────────────────────────────────────

type SearchConfig = {
  required_keywords: string[]
  excluded_keywords: string[]
  keyword_match_fields: string[]
  excluded_stack: string[]
}

function loadConfig(db: Database.Database): {
  config: SearchConfig
  weights: Record<string, number>
  userYoe: number
} {
  const configRow = db
    .prepare(
      `SELECT required_keywords, excluded_keywords, keyword_match_fields,
              excluded_stack, ranking_weights
       FROM search_config WHERE id = 1`,
    )
    .get() as
    | {
        required_keywords: string
        excluded_keywords: string
        keyword_match_fields: string
        excluded_stack: string
        ranking_weights: string
      }
    | undefined

  const config = {
    required_keywords: parseJsonArray(configRow?.required_keywords),
    excluded_keywords: parseJsonArray(configRow?.excluded_keywords),
    keyword_match_fields: parseJsonArray(configRow?.keyword_match_fields).length
      ? parseJsonArray(configRow?.keyword_match_fields)
      : ['title', 'tech_stack'],
    excluded_stack: parseJsonArray(configRow?.excluded_stack),
  }

  const userYoe = computeYoeFromEntries(getAllEntries(db))

  return { config, weights: parseWeights(configRow?.ranking_weights), userYoe }
}

function rankFiltered(filtered: JobPosting[], weights: Record<string, number>): JobPosting[] {
  const now = Date.now()
  return filtered
    .map((p) => ({ posting: p, score: compositeScore(p, weights, now) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.posting)
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Fast synchronous path — returns postings with cached scores only, no API calls. */
export function getFilteredRankedPostings(db: Database.Database): JobPosting[] {
  const rows = db
    .prepare(`SELECT * FROM job_postings WHERE raw_text IS NOT NULL AND archived_at IS NULL`)
    .all() as JobPostingRow[]
  const { config, weights, userYoe } = loadConfig(db)
  const filtered = applyHardFilters(rows.map(rowToPosting), config, userYoe)
  return rankFiltered(filtered, weights)
}

/** Slow path — runs affinity scoring via Claude then returns fully-ranked postings. */
export async function getRankedPostings(
  db: Database.Database,
  apiKey: string,
  onQuotaError?: QuotaErrorCallback,
): Promise<JobPosting[]> {
  const rows = db
    .prepare(`SELECT * FROM job_postings WHERE raw_text IS NOT NULL AND archived_at IS NULL`)
    .all() as JobPostingRow[]
  const { config, weights, userYoe } = loadConfig(db)
  const filtered = applyHardFilters(rows.map(rowToPosting), config, userYoe)

  const needsScoring = filtered.filter((p) => p.affinity_score === null)
  if (needsScoring.length > 0) {
    await scorePostings(db, apiKey, needsScoring, onQuotaError)
    const rescoredIds = [...new Set(needsScoring.map((p) => p.id))]
    const placeholders = rescoredIds.map(() => '?').join(',')
    const freshRows = db
      .prepare(`SELECT * FROM job_postings WHERE id IN (${placeholders})`)
      .all(rescoredIds) as JobPostingRow[]
    const freshMap = new Map(freshRows.map((r) => [r.id, rowToPosting(r)]))
    for (let i = 0; i < filtered.length; i++) {
      if (freshMap.has(filtered[i].id)) filtered[i] = freshMap.get(filtered[i].id)!
    }
  }

  return rankFiltered(filtered, weights)
}

