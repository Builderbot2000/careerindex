import fetch from 'node-fetch'
import { load } from 'cheerio'
import { BaseAdapter, type JobPosting, type SearchFilters, type CrawlSignal } from '../base'
import { extractYoe, extractSeniority, extractTechStack } from '../linkedin'

const SOURCE = 'ycombinator'
const SCRAPER_VERSION = 'ycombinator-adapter@2'

const ALGOLIA_BASE = 'https://hn.algolia.com/api/v1/search_by_date'
const HN_ITEM_BASE = 'https://news.ycombinator.com/item'

const PAGE_SIZE = 30
const MAX_PAGES = 3

// ─── Algolia response types ───────────────────────────────────────────────────

interface AlgoliaHit {
  objectID: string
  title: string        // "Company (YC F24) Is Hiring" — role is NOT here
  url?: string         // external job posting URL
  created_at: string   // ISO 8601
  created_at_i: number // Unix timestamp
}

interface AlgoliaResponse {
  hits: AlgoliaHit[]
  nbPages: number
  page: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function recencyCutoffTs(recency: 'day' | 'week' | 'month'): number {
  const now = Math.floor(Date.now() / 1000)
  switch (recency) {
    case 'day':   return now - 86400
    case 'week':  return now - 604800
    case 'month': return now - 2592000
  }
}

export interface ParsedHNTitle {
  company: string
  title: string
}

/**
 * Extracts company name from HN job post titles such as:
 *   "Company (YC W21) Is Hiring"
 *   "Company Is Hiring: Role"   (role embedded in Algolia title — rare)
 *   "Company – Hiring Role"
 *
 * Note: for ycombinator.com link posts the role is NOT in the Algolia title;
 * use titleFromYCUrl() instead for those.
 */
export function parseHNTitle(raw: string): ParsedHNTitle {
  // Strip trailing " (domain.com)" e.g. "(ashbyhq.com)", "(jiga.io)"
  const stripped = raw.replace(/\s*\([a-z0-9-]+\.[a-z]{2,}\)\s*$/i, '').trim()

  // Match on "is hiring" / "hiring" keyword, with optional leading dash/colon
  const hiringMatch = stripped.match(/^(.+?)\s*[–—-]?\s*(?:is\s+)?hiring[:\s–—-]\s*(.*)/i)

  if (!hiringMatch) {
    // No "hiring" found — return full title as both fields
    const company = stripped.replace(/\s*\(YC\s+[WSFW]\d{2,4}\)/i, '').trim()
    return { company: company || stripped, title: stripped }
  }

  let company = hiringMatch[1].trim()
  let role    = hiringMatch[2].trim()

  // Strip trailing em/en/hyphen-dash from company (e.g. "MDalgorithms –")
  company = company.replace(/\s*[–—-]+\s*$/, '').trim()

  // Strip YC batch tag: "(YC W21)", "(YC S24)", "(YC F24)", "(YC P26)"
  company = company.replace(/\s*\(YC\s+[WSFW P]\d{2,4}\)/gi, '').trim()

  // If role is empty (plain "Company Is Hiring"), fall back to original title
  if (!role) {
    role = stripped
  }

  return { company: company || stripped, title: role || stripped }
}

// YC job URLs: /companies/{slug}/jobs/{7-char-id}-{role-slug}
const YC_JOB_RE = /ycombinator\.com\/companies\/[^/]+\/jobs\/[A-Za-z0-9]+-(.+)$/

/**
 * Extracts the job role from a ycombinator.com job URL.
 * e.g. ".../jobs/rEWfZ6R-senior-forward-deployed-engineer" → "Senior Forward Deployed Engineer"
 */
export function titleFromYCUrl(url: string): string | null {
  const m = url.match(YC_JOB_RE)
  if (!m) return null
  return m[1].split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

/**
 * Fetches a job posting page and returns its plain-text body.
 * Returns null on any fetch or parse error.
 */
async function fetchJobText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; careerindex-bot/1.0)' },
    })
    if (!res.ok) return null
    const html = await res.text()
    const $ = load(html)
    $('script, style, nav, header, footer').remove()
    const text = ($('main').length ? $('main') : $('body'))
      .text()
      .replace(/\s{2,}/g, ' ')
      .trim()
    return text || null
  } catch {
    return null
  }
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class YCombinatorAdapter extends BaseAdapter {
  readonly id = 'ycombinator'
  readonly delayMs = 500
  readonly availableSignals = new Set(['recency'])
  readonly ignoresTerm = true

  async search(
    _term: string,
    filters: SearchFilters,
    onPosting?: (posting: Omit<JobPosting, 'id'>) => void,
    _onCaptchaRequired?: () => Promise<void>,
    signal?: CrawlSignal,
  ): Promise<void> {
    let reportedCount = 0
    const maxResults = filters.maxResults ?? PAGE_SIZE * MAX_PAGES
    const cutoff = filters.recency ? recencyCutoffTs(filters.recency) : null

    let page       = 0
    let totalPages = 1

    while (page < totalPages && page < MAX_PAGES && reportedCount < maxResults) {
      await signal?.waitForResume()
      signal?.checkAborted()

      const params = new URLSearchParams({
        tags:        'job',
        hitsPerPage: String(Math.min(PAGE_SIZE, maxResults - reportedCount)),
        page:        String(page),
      })
      if (cutoff !== null) {
        params.set('numericFilters', `created_at_i>${cutoff}`)
      }

      const response = await fetch(`${ALGOLIA_BASE}?${params}`)
      if (!response.ok) break

      const data = await response.json() as AlgoliaResponse
      totalPages = data.nbPages

      for (const hit of data.hits) {
        if (reportedCount >= maxResults) break
        await signal?.waitForResume()
        signal?.checkAborted()

        const url = hit.url ?? `${HN_ITEM_BASE}?id=${hit.objectID}`

        // Algolia title is "Company (YC F24) Is Hiring" — use it only for company.
        // Role comes from the URL slug for YC URLs; fall back to the Algolia title.
        const parsed  = parseHNTitle(hit.title)
        const ycTitle = titleFromYCUrl(url)
        const title   = ycTitle ?? parsed.title

        // Fetch job page text for YC URLs; fall back to the HN title.
        // raw_text must be non-null or the ranker query silently drops the row.
        let rawText: string
        if (hit.url) {
          rawText = await fetchJobText(hit.url) ?? title
        } else {
          rawText = title
        }

        const combinedText = `${title} ${rawText}`
        const { yoe_min, yoe_max } = extractYoe(combinedText)
        const seniority  = extractSeniority(title, rawText)
        const tech_stack = extractTechStack(combinedText)
        const posted_at  = hit.created_at.slice(0, 10)
        const now        = new Date().toISOString()

        onPosting?.({
          source:              SOURCE,
          url,
          resolved_domain:     null,
          title,
          company:             parsed.company,
          location:            '',
          yoe_min,
          yoe_max,
          seniority,
          tech_stack,
          posted_at,
          applicant_count:     null,
          raw_text:            rawText,
          fetched_at:          now,
          scraper_mod_version: SCRAPER_VERSION,
          status:              'new',
          affinity_score:      null,
          affinity_skipped:    false,
          affinity_scored_at:  null,
          affinity_reasoning:  null,
          description_snippet: null,
          hard_reqs_class:     null,
          nice_to_haves_class: null,
          first_response_at:   null,
          last_seen_at:        now,
          salary_min:          null,
          salary_max:          null,
          company_rating:      null,
        })
        reportedCount++

        await new Promise<void>(resolve => setTimeout(resolve, this.delayMs))
      }

      page++
    }
  }
}

export default YCombinatorAdapter
