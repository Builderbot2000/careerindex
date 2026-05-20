import fetch from 'node-fetch'
import { load } from 'cheerio'
import { BaseAdapter, type JobPosting, type SearchFilters, type CrawlSignal } from '../base'
import { extractYoe, extractSeniority, extractTechStack } from '../linkedin'

const SOURCE = 'hnhiring'
const SCRAPER_VERSION = 'hnhiring-adapter@2'
const BASE_URL = 'https://hnhiring.com'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns YYYY-MM-DD cutoff date relative to now. */
export function recencyCutoffDate(recency: 'day' | 'week' | 'month'): string {
  const d = new Date()
  switch (recency) {
    case 'day':   d.setDate(d.getDate() - 1);   break
    case 'week':  d.setDate(d.getDate() - 7);   break
    case 'month': d.setMonth(d.getMonth() - 1); break
  }
  return d.toISOString().slice(0, 10)
}

export interface ParsedFirstLine {
  company: string
  title: string
  location: string
}

/**
 * Parses the pipe-separated first line of an HNHiring job posting.
 * Typical format: "Company | Role | Location | ..."
 */
export function parseFirstLine(raw: string): ParsedFirstLine {
  const parts = raw.split('|').map(s => s.trim()).filter(Boolean)
  if (parts.length === 0) return { company: '', title: raw.trim(), location: '' }

  const company  = parts[0] ?? ''
  const title    = parts[1] ?? ''
  const location = parts[2] ?? ''

  return { company, title, location }
}

/**
 * Converts HN-style relative timestamps to YYYY-MM-DD.
 * e.g. "about 4 hours ago" → today, "3 days ago" → 3 days before today
 */
export function parseRelativeTime(text: string, now: Date = new Date()): string {
  const s = text.toLowerCase().trim()
  const d = new Date(now)

  const minuteMatch = s.match(/(\d+)\s+minute/)
  const hourMatch   = s.match(/(\d+)\s+hour/)
  const dayMatch    = s.match(/(\d+)\s+day/)
  const weekMatch   = s.match(/(\d+)\s+week/)
  const monthMatch  = s.match(/(\d+)\s+month/)

  if (minuteMatch || hourMatch) {
    // same day — no offset
  } else if (dayMatch) {
    d.setDate(d.getDate() - parseInt(dayMatch[1], 10))
  } else if (weekMatch) {
    d.setDate(d.getDate() - parseInt(weekMatch[1], 10) * 7)
  } else if (monthMatch) {
    d.setMonth(d.getMonth() - parseInt(monthMatch[1], 10))
  }
  // fallback: today

  return d.toISOString().slice(0, 10)
}

/** Lowercases and slugifies a string for use in a URL fragment. */
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** Returns true if the posting's text fields contain the search term. */
function matchesTerm(posting: Omit<JobPosting, 'id'>, term: string): boolean {
  if (!term) return true
  const needle = term.toLowerCase()
  return (
    (posting.raw_text?.toLowerCase().includes(needle) ?? false) ||
    posting.title.toLowerCase().includes(needle) ||
    posting.company.toLowerCase().includes(needle)
  )
}

/** Parses all job postings out of an hnhiring month-page HTML string. */
export function parsePostings(html: string, pageUrl: string): Omit<JobPosting, 'id'>[] {
  const $ = load(html)
  const postings: Omit<JobPosting, 'id'>[] = []
  const fetchedAt = new Date().toISOString()

  // ul.jobs li.job matches both visible and hidden (li.job.hidden) elements —
  // the "hidden" class is additive so all ~270 jobs are captured.
  $('ul.jobs li.job').each((_i, el) => {
    const userLink = $(el).find('div.user.green > a').first()
    const username = userLink.text().trim()
    const relTime  = $(el).find('span.type-info').first().text().trim()
    const bodyEl   = $(el).find('div.body').first()

    if (!username || !relTime) return

    // First text node before the first <p> is the structured summary line.
    const firstLine = bodyEl
      .contents()
      .filter((_j, n) => n.type === 'text')
      .first()
      .text()
      .trim()

    const rawText = bodyEl.text().trim()

    // Skip job-seeker posts (e.g. "SEEKING | ...")
    if (firstLine.split('|')[0].trim().toUpperCase() === 'SEEKING') return

    const { company, title, location } = parseFirstLine(firstLine)
    if (!company) return

    // Synthetic per-posting URL: opens the bulk month page, fragment is for dedup.
    const fragment = slugify(`${company}-${title}`)
    const url = fragment ? `${pageUrl}#${fragment}` : pageUrl

    // Best external domain from first non-HN link in body.
    let resolved_domain: string | null = null
    bodyEl.find('a[href]').each((_j, a) => {
      if (resolved_domain) return
      const href = $(a).attr('href') ?? ''
      try {
        const u = new URL(href)
        if (u.hostname && !u.hostname.includes('ycombinator.com')) {
          resolved_domain = u.hostname.replace(/^www\./, '')
        }
      } catch {
        // skip invalid URLs
      }
    })

    const combinedText = `${title} ${rawText}`
    const { yoe_min, yoe_max } = extractYoe(combinedText)
    const seniority  = extractSeniority(title, rawText)
    const tech_stack = extractTechStack(combinedText)

    postings.push({
      source:              SOURCE,
      url,
      resolved_domain,
      title:               title || company,
      company,
      location,
      yoe_min,
      yoe_max,
      seniority,
      tech_stack,
      posted_at:           parseRelativeTime(relTime),
      applicant_count:     null,
      raw_text:            rawText,
      fetched_at:          fetchedAt,
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
      last_seen_at:        fetchedAt,
      salary_min:          null,
      salary_max:          null,
      company_rating:      null,
    })
  })

  return postings
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class HNHiringAdapter extends BaseAdapter {
  readonly id = 'hnhiring'
  readonly delayMs = 500
  readonly availableSignals = new Set(['recency'])
  readonly ignoresTerm = true

  async search(
    term: string,
    filters: SearchFilters,
    onPosting?: (posting: Omit<JobPosting, 'id'>) => void,
    _onCaptchaRequired?: () => Promise<void>,
    signal?: CrawlSignal,
  ): Promise<void> {
    const maxResults = filters.maxResults ?? 100
    const cutoff     = filters.recency ? recencyCutoffDate(filters.recency) : null

    // Step 1: homepage to discover the current month slug (e.g. "may-2026").
    const homeRes = await fetch(BASE_URL)
    if (!homeRes.ok) return
    const homeHtml = await homeRes.text()
    const $home = load(homeHtml)

    let slug: string | null = null
    $home('a[href]').each((_i, el) => {
      if (slug) return
      const href = $home(el).attr('href') ?? ''
      const m = href.match(/^\/([a-z]+-\d{4})$/)
      if (m) slug = m[1]
    })
    if (!slug) return

    // Step 2: fetch the actual month listing page.
    const pageUrl = `${BASE_URL}/${slug}`
    const response = await fetch(pageUrl)
    if (!response.ok) return
    const html = await response.text()
    const postings = parsePostings(html, pageUrl)

    let reportedCount = 0

    for (const posting of postings) {
      if (reportedCount >= maxResults) break

      // Postings are newest-first; stop as soon as we fall below the cutoff.
      if (cutoff !== null && posting.posted_at !== null && posting.posted_at < cutoff) break

      if (!matchesTerm(posting, term)) continue

      await signal?.waitForResume()
      signal?.checkAborted()

      onPosting?.(posting)
      reportedCount++
    }
  }
}

export default HNHiringAdapter
