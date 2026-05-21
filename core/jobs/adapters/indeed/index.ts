import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { BaseAdapter, type JobPosting, type SearchFilters, type CrawlSignal } from '../base'
import { extractYoe, extractSeniority, extractTechStack } from '../linkedin'

const SOURCE = 'indeed'
const SCRAPER_VERSION = 'indeed-adapter@1'

/** Indeed restricts search results to 1 page (~10 cards) without login. */
const MAX_PAGES = 1
const MAX_PAGES_LOGGED_IN = 10
const PAGE_SIZE = 10

/** Abort a search term after this many consecutive card-level parse failures. */
const MAX_CONSECUTIVE_FAILS = 5

// ─── Selectors ────────────────────────────────────────────────────────────────
// Centralised here so they are easy to update when Indeed's DOM changes.

export const SELECTORS = {
  // Stable job-key attribute — used as the presence signal for loaded results
  anyJobKey: '[data-jk]',
  // Inline detail panel (right-side panel rendered when a card is selected)
  inlineDetail: '#jobDescriptionText',
  // Auth wall detection
  authWallInput: '#login-email-input',
} as const

// ─── Filter maps and URL helpers ──────────────────────────────────────────────

const RECENCY_MAP: Record<string, string> = {
  day: '1',
  week: '7',
  month: '30',
}

/**
 * Maps country names (and common aliases) to Indeed's country-specific host.
 * When the user types a country as the location, we route the search to the
 * matching subdomain instead of www.indeed.com — otherwise Indeed shows a
 * cross-border banner ("Showing all jobs in the US. Do you want to see jobs
 * in Canada only?") that blocks/hides results on the US domain.
 */
const COUNTRY_HOSTS: Record<string, string> = {
  'canada': 'ca.indeed.com',
  'united kingdom': 'uk.indeed.com',
  'uk': 'uk.indeed.com',
  'great britain': 'uk.indeed.com',
  'australia': 'au.indeed.com',
  'india': 'in.indeed.com',
  'germany': 'de.indeed.com',
  'france': 'fr.indeed.com',
  'ireland': 'ie.indeed.com',
  'netherlands': 'nl.indeed.com',
  'spain': 'es.indeed.com',
  'italy': 'it.indeed.com',
  'singapore': 'sg.indeed.com',
  'new zealand': 'nz.indeed.com',
  'japan': 'jp.indeed.com',
  'mexico': 'mx.indeed.com',
  'brazil': 'br.indeed.com',
  'united states': 'www.indeed.com',
  'usa': 'www.indeed.com',
  'us': 'www.indeed.com',
}

/**
 * Returns the Indeed host and a normalized location string for a given filter.
 * If the location is a recognized country, the country-specific subdomain is
 * used and the `l` param is dropped (the host already scopes results to that
 * country). Otherwise the default US host is used and the location is passed
 * through as the `l` param.
 */
export function resolveHostAndLocation(location: string | undefined): { host: string; locationParam: string | undefined } {
  if (!location) return { host: 'www.indeed.com', locationParam: undefined }
  const host = COUNTRY_HOSTS[location.trim().toLowerCase()]
  if (host) return { host, locationParam: undefined }
  return { host: 'www.indeed.com', locationParam: location }
}

export function buildSearchUrl(term: string, filters: SearchFilters, start: number): string {
  const { host, locationParam } = resolveHostAndLocation(filters.location)
  const params = new URLSearchParams()
  if (term) params.set('q', term)
  if (locationParam) params.set('l', locationParam)
  if (filters.recency && RECENCY_MAP[filters.recency]) params.set('fromage', RECENCY_MAP[filters.recency])
  if (filters.workTypes?.includes('remote')) params.set('remotejob', '1')
  params.set('start', String(start))
  return `https://${host}/jobs?${params.toString()}`
}

/**
 * Produces the canonical Indeed job URL from a job key (`jk` param), stripping
 * all tracking tokens from search-result hrefs.
 */
export function cleanJobUrl(jk: string): string {
  return `https://www.indeed.com/viewjob?jk=${jk}`
}

// ─── Auth-wall detection ──────────────────────────────────────────────────────

export async function isAuthWall(page: Page): Promise<boolean> {
  if (page.url().includes('/account/')) return true
  const loginInput = await page.$(SELECTORS.authWallInput)
  return loginInput !== null
}

// ─── Date parser ─────────────────────────────────────────────────────────────

/**
 * Parses Indeed's relative date text into an ISO date string (YYYY-MM-DD).
 * Returns null for unrecognised formats or imprecise ranges like "30+ days ago".
 */
export function parsePostedAt(text: string): string | null {
  const normalised = text.trim().toLowerCase()

  if (normalised === 'just posted' || normalised === 'today') {
    return new Date().toISOString().slice(0, 10)
  }

  // "30+ days ago" — not precise enough to be useful
  if (/30\+/.test(normalised)) return null

  const m = normalised.match(/(\d+)\s+(day|week|month)s?\s+ago/)
  if (!m) return null

  const n = parseInt(m[1], 10)
  const unit = m[2]
  const d = new Date()

  switch (unit) {
    case 'day':   d.setDate(d.getDate() - n); break
    case 'week':  d.setDate(d.getDate() - n * 7); break
    case 'month': d.setMonth(d.getMonth() - n); break
  }

  return d.toISOString().slice(0, 10)
}

// ─── DOM parsers ─────────────────────────────────────────────────────────────

export interface ParsedCard {
  jk: string
  href: string
  title: string
  company: string
  location: string
  posted_at: string | null
}

/**
 * Extracts all job cards from the current search-results page in a single
 * page.evaluate() call. This avoids the Playwright stale-ElementHandle error
 * that occurs when Indeed's SPA re-renders the list between async accesses.
 */
export async function extractCards(page: Page): Promise<ParsedCard[]> {
  const rawCards = await page.evaluate(() => {
    // Try multiple container selectors in priority order
    const containerSelectors = [
      '#mosaic-provider-jobcards ul > li',
      '[data-testid="jobsearch-ResultsList"] li',
      '.resultsList li',
      // Last resort: any li that contains a data-jk link
      'li:has(a[data-jk])',
    ]

    let items: { querySelector: (s: string) => any; querySelectorAll: (s: string) => any }[] = []
    for (const sel of containerSelectors) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const found = Array.from((globalThis as any).document.querySelectorAll(sel))
        if (found.length > 0) { items = found as typeof items; break }
      } catch { /* selector unsupported — try next */ }
    }

    return items.map((li) => {
      const link =
        li.querySelector('h2.jobTitle a[data-jk]') ??
        li.querySelector('a[data-jk]')

      const titleEl =
        li.querySelector('[id^="jobTitle"]') ??
        li.querySelector('h2.jobTitle a span') ??
        li.querySelector('h2.jobTitle a')

      const companyEl =
        li.querySelector('[data-testid="company-name"]') ??
        li.querySelector('.companyName')

      const locationEl =
        li.querySelector('[data-testid="text-location"]') ??
        li.querySelector('[data-testid="job-location"]') ??
        li.querySelector('.companyLocation')

      const dateEl =
        li.querySelector('[data-testid="myJobsStateDate"]') ??
        li.querySelector('[data-testid="post-age"]') ??
        li.querySelector('.date') ??
        li.querySelector('span.result-link-bar-separator ~ span')

      return {
        jk: link?.getAttribute('data-jk') ?? null,
        title: titleEl?.textContent?.trim() ?? null,
        company: companyEl?.textContent?.trim() ?? null,
        location: locationEl?.textContent?.trim() ?? '',
        postedText: dateEl?.textContent?.trim() ?? '',
      }
    })
  })

  const results: ParsedCard[] = []
  for (const raw of rawCards) {
    if (!raw.jk || !raw.title || !raw.company) continue
    results.push({
      jk: raw.jk,
      href: cleanJobUrl(raw.jk),
      title: raw.title,
      company: raw.company,
      location: raw.location,
      posted_at: parsePostedAt(raw.postedText),
    })
  }
  return results
}

export interface ParsedDetail {
  raw_text: string | null
}

export async function parseInlineDetail(page: Page): Promise<ParsedDetail> {
  const descEl = await page.$(SELECTORS.inlineDetail)
  const raw_text = descEl ? (await descEl.innerText()).trim() : null
  return { raw_text }
}

// ─── Delay helper ─────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class IndeedAdapter extends BaseAdapter {
  override readonly id = 'indeed'
  override readonly requiresChromium = true
  override readonly delayMs = 3000
  override readonly availableSignals = new Set(['recency'])
  override readonly supportsLogin = true

  private _sharedBrowser: Browser | undefined = undefined

  override async beginLogin(): Promise<() => Promise<void>> {
    const browser = await chromium.launch({
      headless: false,
      args: ['--disable-blink-features=AutomationControlled'],
    })
    this._sharedBrowser = browser
    const page = await browser.newPage()
    await page.goto('https://secure.indeed.com/auth', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    }).catch(() => {})
    return async () => {
      this._sharedBrowser = undefined
      await browser.close().catch(() => {})
    }
  }

  override async search(
    term: string,
    filters: SearchFilters,
    onPosting?: (posting: Omit<JobPosting, 'id'>) => void,
    onCaptchaRequired?: () => Promise<void>,
    signal?: CrawlSignal,
  ): Promise<void> {
    const loggedIn = this._sharedBrowser !== undefined
    const browser = this._sharedBrowser ?? await chromium.launch({
      headless: false,
      args: ['--disable-blink-features=AutomationControlled'],
    })
    const ownsBrowser = !loggedIn
    try {
      await this._scrape(browser, term, filters, onPosting, onCaptchaRequired, signal, loggedIn)
    } finally {
      if (ownsBrowser) await browser.close()
    }
  }

  private async _scrape(
    browser: Browser,
    term: string,
    filters: SearchFilters,
    onPosting?: (posting: Omit<JobPosting, 'id'>) => void,
    onCaptchaRequired?: () => Promise<void>,
    signal?: CrawlSignal,
    loggedIn = false,
  ): Promise<void> {
    const context: BrowserContext = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    })
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false })
    })
    const searchPage = await context.newPage()
    let consecutiveFails = 0
    let reportedCount = 0
    const now = new Date().toISOString()
    const maxPages = loggedIn ? MAX_PAGES_LOGGED_IN : MAX_PAGES
    const pageLimit = filters.maxResults != null
      ? Math.min(Math.ceil(filters.maxResults / PAGE_SIZE), maxPages)
      : maxPages

    for (let pageNum = 0; pageNum < pageLimit; pageNum++) {
      await signal?.waitForResume()
      signal?.checkAborted()

      const url = buildSearchUrl(term, filters, pageNum * PAGE_SIZE)
      await searchPage.goto(url, { waitUntil: 'load', timeout: 30_000 })
      console.log(`[indeed] page ${pageNum} landed on: ${searchPage.url()}`)

      // Graceful abort on auth wall
      if (await isAuthWall(searchPage)) {
        console.warn(`[indeed] auth wall detected on page ${pageNum}, url: ${searchPage.url()}`)
        if (onCaptchaRequired) {
          await onCaptchaRequired()
          await searchPage.waitForTimeout(1000)
          if (await isAuthWall(searchPage)) {
            console.warn('[indeed] auth wall persists after resume, aborting')
            break
          }
        } else {
          break
        }
      }

      // Wait for at least one job-key element — more stable than the ul container
      try {
        await searchPage.waitForSelector(SELECTORS.anyJobKey, { timeout: 15_000 })
      } catch {
        console.warn(`[indeed] waitForSelector([data-jk]) timed out on page ${pageNum}, url: ${searchPage.url()}`)
        break
      }

      // Extract all card data in one evaluate() call to avoid stale handles
      const cards = await extractCards(searchPage)
      console.log(`[indeed] page ${pageNum} extracted ${cards.length} cards`)
      if (cards.length === 0) break

      for (const card of cards) {
        if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) return
        if (filters.maxResults != null && reportedCount >= filters.maxResults) return

        const { href, title, company, location, posted_at } = card

        let raw_text: string | null = null

        await delay(this.delayMs)

        try {
          // Click the card link to load the inline detail panel — no separate page needed
          const cardLink = await searchPage.$(`a[data-jk="${card.jk}"]`)
          if (cardLink) {
            await cardLink.click()
            await searchPage.waitForSelector(SELECTORS.inlineDetail, { timeout: 10_000 })
            const detail = await parseInlineDetail(searchPage)
            raw_text = detail.raw_text
          }
        } catch {
          // Inline panel failed to load — continue with card-level data only
        }

        const { yoe_min, yoe_max } = extractYoe(raw_text ?? '')
        const seniority = extractSeniority(title, raw_text ?? '')
        const tech_stack = extractTechStack(raw_text ?? title)

        onPosting?.({
          source: SOURCE,
          url: href,
          resolved_domain: null,
          title,
          company,
          location,
          yoe_min,
          yoe_max,
          seniority,
          tech_stack,
          posted_at,
          applicant_count: null,
          raw_text,
          fetched_at: now,
          scraper_mod_version: SCRAPER_VERSION,
          status: 'new',
          affinity_score: null,
          affinity_skipped: false,
          affinity_scored_at: null,
          affinity_reasoning: null,
          description_snippet: null,
          hard_reqs_class: null,
          nice_to_haves_class: null,
          first_response_at: null,
          last_seen_at: now,
          salary_min: null,
          salary_max: null,
          company_rating: null,
        })
        reportedCount++
        consecutiveFails = 0
      }
    }
  }
}

export default IndeedAdapter
