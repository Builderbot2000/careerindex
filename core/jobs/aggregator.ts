import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import type { JobPosting, SearchFilters, CrawlController, CrawlSignal } from './adapters/base'
import type { BaseAdapter } from './adapters/base'
import type { AdapterProgress, ScrapeSummary } from '../../src/shared/ipc-types'

function compositeKey(company: string, title: string, posted_at: string | null): string {
  return `${company.toLowerCase()}::${title.toLowerCase().replace(/\s+/g, ' ').trim()}::${posted_at ?? ''}`
}

// ─── Filters ──────────────────────────────────────────────────────────────────

function matchesCompanyBan(company: string, pattern: string): boolean {
  try {
    return new RegExp(pattern, 'i').test(company)
  } catch {
    return company.toLowerCase().includes(pattern.toLowerCase())
  }
}

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

// ─── Crawl controller ─────────────────────────────────────────────────────────

export function createCrawlController(): CrawlController {
  let paused = false
  let aborted = false
  let resumeResolve: (() => void) | null = null

  const signal: CrawlSignal = {
    get aborted() { return aborted },
    async waitForResume() {
      if (!paused) return
      await new Promise<void>((res) => { resumeResolve = res })
    },
    checkAborted() {
      if (aborted) throw new Error('crawl_aborted')
    },
  }

  return {
    signal,
    pause() { paused = true },
    resume() {
      paused = false
      resumeResolve?.()
      resumeResolve = null
    },
    abort() {
      aborted = true
      paused = false
      resumeResolve?.()
      resumeResolve = null
    },
  }
}

// ─── Per-posting insert ───────────────────────────────────────────────────────

const INSERT_SQL = `
  INSERT INTO job_postings (
    id, source, url, resolved_domain, title, company, location,
    yoe_min, yoe_max, seniority, tech_stack, posted_at, applicant_count,
    raw_text, fetched_at, scraper_mod_version, status,
    affinity_score, affinity_skipped, affinity_scored_at, first_response_at, last_seen_at,
    salary_min, salary_max, company_rating, required_seniorities
  ) VALUES (
    @id, @source, @url, @resolved_domain, @title, @company, @location,
    @yoe_min, @yoe_max, @seniority, @tech_stack, @posted_at, @applicant_count,
    @raw_text, @fetched_at, @scraper_mod_version, @status,
    @affinity_score, @affinity_skipped, @affinity_scored_at, @first_response_at, @last_seen_at,
    @salary_min, @salary_max, @company_rating, @required_seniorities
  )
`

interface Counters {
  fetched: number
  dupes: number
  ban_excluded: number
  keyword_filtered: number
  term_filtered: number
  netNew: number
}

// ─── Post-parse search term constraint filter ─────────────────────────────────

interface RunConstraints {
  seniorities?: Array<'intern' | 'junior' | 'mid' | 'senior' | 'staff'>
  workTypes?: Array<'remote' | 'hybrid' | 'onsite'>
  location?: string
  recency?: string
}

function matchesRunConstraints(posting: Omit<JobPosting, 'id'>, run: RunConstraints): boolean {
  const locLower = posting.location.toLowerCase()

  // Seniority: drop only on a definite mismatch from the cheap regex
  // pre-classifier. When the regex returns 'any' we defer the decision to the
  // scoring LLM, which gets a second pass at filtering via required_seniorities
  // stored on the posting (see scorer.ts).
  if (run.seniorities?.length && posting.seniority !== 'any') {
    if (!run.seniorities.includes(posting.seniority)) return false
  }

  // Work type — inferred from location string keywords
  if (run.workTypes?.length) {
    const isRemote = locLower.includes('remote')
    const isHybrid = locLower.includes('hybrid')
    const isOnsite = !isRemote

    const allowed = new Set(run.workTypes)
    let ok = false
    if (allowed.has('remote') && isRemote) ok = true
    if (allowed.has('hybrid') && isHybrid) ok = true
    if (allowed.has('onsite') && isOnsite) ok = true
    if (!ok) return false
  }

  // Location: city-name substring match; remote postings bypass (valid everywhere)
  if (run.location) {
    const city = run.location.split(',')[0].trim().toLowerCase()
    if (city.length > 2 && !locLower.includes(city) && !locLower.includes('remote')) {
      return false
    }
  }

  // Recency: verify posted_at falls within the requested window
  if (run.recency && posting.posted_at) {
    const ageDays = (Date.now() - new Date(posting.posted_at).getTime()) / 86_400_000
    const maxDays = run.recency === 'day' ? 1 : run.recency === 'week' ? 7 : 30
    if (ageDays > maxDays) return false
  }

  return true
}

function processPosting(
  db: Database.Database,
  insert: ReturnType<Database.Database['prepare']>,
  posting: Omit<JobPosting, 'id'>,
  existingUrls: Set<string>,
  existingComposites: Set<string>,
  banConfig: { companyBans: string[]; domainBans: Set<string> },
  keywordConfig: { required: string[]; excluded: string[]; matchFields: string[] },
  counters: Counters,
  runConstraints?: RunConstraints,
): JobPosting | null {
  counters.fetched++

  // Dedup
  const ck = compositeKey(posting.company, posting.title, posting.posted_at)
  if (existingUrls.has(posting.url) || existingComposites.has(ck)) {
    counters.dupes++
    return null
  }

  // Ban list
  const banned =
    banConfig.companyBans.some((pat) => matchesCompanyBan(posting.company, pat)) ||
    (posting.resolved_domain !== null && banConfig.domainBans.has(posting.resolved_domain))
  if (banned) {
    counters.ban_excluded++
    return null
  }

  // Keyword filter
  if (keywordConfig.required.length > 0 || keywordConfig.excluded.length > 0) {
    const parts: string[] = []
    if (keywordConfig.matchFields.includes('title')) parts.push(posting.title)
    if (keywordConfig.matchFields.includes('tech_stack')) parts.push(...posting.tech_stack)
    if (keywordConfig.matchFields.includes('raw_text') && posting.raw_text) parts.push(posting.raw_text)
    const haystack = parts.join(' ').toLowerCase()

    for (const kw of keywordConfig.excluded) {
      const pattern = kw.startsWith('re:') ? new RegExp(kw.slice(3), 'i') : kw.toLowerCase()
      if (typeof pattern === 'string' ? haystack.includes(pattern) : pattern.test(haystack)) {
        counters.keyword_filtered++
        return null
      }
    }

    if (keywordConfig.required.length > 0) {
      const ok = keywordConfig.required.some((kw) => {
        const pattern = kw.startsWith('re:') ? new RegExp(kw.slice(3), 'i') : kw.toLowerCase()
        return typeof pattern === 'string' ? haystack.includes(pattern) : pattern.test(haystack)
      })
      if (!ok) {
        counters.keyword_filtered++
        return null
      }
    }
  }

  // Search term constraint filter (post-parse re-check of seniority/work-type/location/recency)
  if (runConstraints && !matchesRunConstraints(posting, runConstraints)) {
    counters.term_filtered++
    return null
  }

  // Insert
  const full: JobPosting = {
    ...posting,
    id: randomUUID(),
    required_seniorities: runConstraints?.seniorities?.length ? runConstraints.seniorities : null,
  } as JobPosting
  insert.run({
    ...full,
    tech_stack: JSON.stringify(full.tech_stack),
    affinity_skipped: full.affinity_skipped ? 1 : 0,
    required_seniorities: full.required_seniorities ? JSON.stringify(full.required_seniorities) : null,
  })

  existingUrls.add(full.url)
  existingComposites.add(ck)
  counters.netNew++
  return full
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function runScrape(
  db: Database.Database,
  adapters: BaseAdapter[],
  onProgress?: (p: AdapterProgress) => void,
  onCaptchaRequired?: (adapterId: string) => Promise<void>,
  onPostingCommitted?: (p: JobPosting) => void,
  controller?: CrawlController,
  loginAdapterIds?: string[],
  onLoginRequired?: (adapterId: string) => Promise<void>,
): Promise<ScrapeSummary> {
  // Purge invisible zombie postings (raw_text = NULL, never interacted with) so
  // adapters can re-import them with complete data. This handles cases like a
  // source adapter being replaced — e.g. hackernews → ycombinator — where both
  // adapters produce the same URLs but only the new one fetches raw_text.
  db.prepare(`DELETE FROM job_postings WHERE raw_text IS NULL AND status IN ('new', 'viewed')`).run()

  // Collect existing URLs and composite keys from DB for dedup
  const existingUrls = new Set<string>(
    (db.prepare('SELECT url FROM job_postings').all() as { url: string }[]).map((r) => r.url),
  )

  const existingComposites = new Set<string>(
    (
      db
        .prepare('SELECT company, title, posted_at FROM job_postings')
        .all() as { company: string; title: string; posted_at: string | null }[]
    ).map((r) => compositeKey(r.company, r.title, r.posted_at)),
  )

  const counters: Counters = { fetched: 0, dupes: 0, ban_excluded: 0, keyword_filtered: 0, term_filtered: 0, netNew: 0 }

  // Load ban list once
  const bans = db.prepare('SELECT type, value FROM ban_list').all() as {
    type: 'company' | 'domain'; value: string
  }[]
  const banConfig = {
    companyBans: bans.filter((b) => b.type === 'company').map((b) => b.value),
    domainBans: new Set(bans.filter((b) => b.type === 'domain').map((b) => b.value)),
  }

  // Load keyword config once
  const configRow = db
    .prepare('SELECT required_keywords, excluded_keywords, keyword_match_fields FROM search_config WHERE id = 1')
    .get() as { required_keywords: string; excluded_keywords: string; keyword_match_fields: string } | undefined
  const keywordConfig = {
    required: parseJsonArray(configRow?.required_keywords),
    excluded: parseJsonArray(configRow?.excluded_keywords),
    matchFields: parseJsonArray(configRow?.keyword_match_fields).length
      ? parseJsonArray(configRow?.keyword_match_fields)
      : ['title', 'tech_stack'],
  }

  const insert = db.prepare(INSERT_SQL)

  // Load all enabled terms once — they are adapter-global.
  type TermRow = {
    term: string
    locations: string | null
    seniorities: string | null
    work_type: string | null
    recency: string | null
    max_results: number | null
  }
  const allTermRows = db
    .prepare('SELECT term, locations, seniorities, work_type, recency, max_results FROM search_terms WHERE enabled = 1')
    .all() as TermRow[]

  // Expand each term into one run per location (or one run if no locations).
  type ExpandedRun = {
    term: string
    location: string | undefined
    seniorities: SearchFilters['seniorities']
    workTypes: SearchFilters['workTypes']
    recency: SearchFilters['recency']
    maxResults: number | undefined
  }

  function parseJsonArr<T>(raw: string | null): T[] | undefined {
    if (!raw) return undefined
    try {
      const v = JSON.parse(raw)
      return Array.isArray(v) && v.length ? v as T[] : undefined
    } catch {
      return undefined
    }
  }

  const expandedRuns: ExpandedRun[] = []
  const termSource = allTermRows.length > 0
    ? allTermRows
    : [{ term: '', locations: null, seniorities: null, work_type: null, recency: null, max_results: null }]

  for (const row of termSource) {
    const locs = parseJsonArr<string>(row.locations)
    const seniorities = parseJsonArr<'intern'|'junior'|'mid'|'senior'|'staff'>(row.seniorities)
    const workTypes = parseJsonArr<'remote'|'hybrid'|'onsite'>(row.work_type)
    const recency = (row.recency ?? undefined) as SearchFilters['recency']
    const maxResults = row.max_results ?? undefined
    if (locs && locs.length > 0) {
      for (const loc of locs) {
        expandedRuns.push({ term: row.term, location: loc, seniorities, workTypes, recency, maxResults })
      }
    } else {
      expandedRuns.push({ term: row.term, location: undefined, seniorities, workTypes, recency, maxResults })
    }
  }

  await Promise.allSettled(
    adapters.map(async (adapter) => {
      let loginCleanup: (() => Promise<void>) | undefined
      try {
        if (loginAdapterIds?.includes(adapter.id) && adapter.supportsLogin && onLoginRequired) {
          loginCleanup = await adapter.beginLogin()
          await onLoginRequired(adapter.id)
        }

        onProgress?.({ adapterId: adapter.id, status: 'running', fetched: 0 })
        let adapterFetched = 0

        const runsForAdapter = adapter.ignoresTerm ? expandedRuns.slice(0, 1) : expandedRuns
        for (const run of runsForAdapter) {
          const filters: SearchFilters = {}
          if (run.location) filters.location = run.location
          if (run.seniorities) filters.seniorities = run.seniorities
          if (run.workTypes) filters.workTypes = run.workTypes
          if (run.recency) filters.recency = run.recency
          if (run.maxResults != null) filters.maxResults = run.maxResults

          const runConstraints: RunConstraints = {
            seniorities: run.seniorities ?? undefined,
            workTypes: run.workTypes ?? undefined,
            location: run.location,
            recency: run.recency,
          }

          try {
            await adapter.search(
              run.term,
              filters,
              (posting) => {
                adapterFetched++
                onProgress?.({ adapterId: adapter.id, status: 'running', fetched: adapterFetched })
                const committed = processPosting(
                  db, insert, posting,
                  existingUrls, existingComposites,
                  banConfig, keywordConfig, counters,
                  runConstraints,
                )
                if (committed) onPostingCommitted?.(committed)
              },
              onCaptchaRequired ? () => onCaptchaRequired(adapter.id) : undefined,
              controller?.signal,
            )
          } catch (err) {
            if (err instanceof Error && err.message === 'crawl_aborted') {
              onProgress?.({ adapterId: adapter.id, status: 'done', fetched: adapterFetched })
              return
            }
            onProgress?.({
              adapterId: adapter.id,
              status: 'error',
              error: err instanceof Error ? err.message : String(err),
            })
            return
          }
        }

        onProgress?.({ adapterId: adapter.id, status: 'done', fetched: adapterFetched })
      } finally {
        await loginCleanup?.()
      }
    }),
  )

  return {
    fetched: counters.fetched,
    dupes: counters.dupes,
    netNew: counters.netNew,
    ban_excluded: counters.ban_excluded,
    keyword_filtered: counters.keyword_filtered,
    term_filtered: counters.term_filtered,
  }
}
