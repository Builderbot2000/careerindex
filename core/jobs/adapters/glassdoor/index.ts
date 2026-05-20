import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { BaseAdapter, type JobPosting, type SearchFilters, type CrawlSignal } from '../base'
import { extractYoe, extractSeniority, extractTechStack, KNOWN_TECH } from '../linkedin'

export { KNOWN_TECH }

const SOURCE = 'glassdoor'
const SCRAPER_VERSION = 'glassdoor-adapter@1'

/** Maximum search-result pages to fetch per search term (~30 cards per page). */
const MAX_PAGES = 3
const MAX_PAGES_LOGGED_IN = 10
const PAGE_SIZE = 30

/** Abort a search term after this many consecutive card-level parse failures. */
const MAX_CONSECUTIVE_FAILS = 5

// ─── Selectors ────────────────────────────────────────────────────────────────

export const SELECTORS = {
  // Search results
  jobListing: '[data-test="jobListing"]',
  jobTitle: 'a[data-test="job-title"]',
  employerName: '[data-test="employer-name"]',
  empLocation: '[data-test="emp-location"]',
  jobAge: '[data-test="job-age-label"]',
  salaryEstimate: '[data-test="detailSalary"]',
  compactStars: '[data-test="rating-info"]',
  // Detail panel (inline side panel on search page)
  jobDescriptionContent: '[data-test="jobDescriptionContent"]',
  // Standalone job detail page selectors (differ from the inline panel)
  jobDescriptionPage: '[class*="JobDetails_jobDescription"], [class*="jobDescriptionContent"], [id="JobDescriptionContainer"], [class*="desc"] .desc, .jobsearch-JobComponent-description',
  showMore: '[data-test="show-more"], button[class*="ShowMore"], [class*="jobDescriptionContent"] button',
  detailSalary: '[data-test="pay-range"]',
  detailSalaryAlt: '[data-test="salary-estimate"]',
  detailRating: '[data-test="rating-info"]',
  // Pagination
  paginationNext: '[data-test="pagination-next"]',
  // Auth wall / hard-sell
  hardsellDialog: '[data-test="hardsell-dialog"]',
  loginModal: '#LoginModal',
} as const

// ─── Filter maps ──────────────────────────────────────────────────────────────

const RECENCY_MAP: Record<string, string> = {
  day: '1',
  week: '7',
  month: '30',
}

// Glassdoor only accepts a single seniorityType; pick the broadest when multiple
// are requested. Priority order (broadest → most specific):
const SENIORITY_MAP: Record<string, string> = {
  intern: 'internship',
  junior: 'entrylevel',
  mid: 'midseniorlevel',
  senior: 'senior',
  staff: 'director',
}

// When multiple seniorities are requested, choose the median value rather than
// the extreme, to avoid over-filtering. Rank: intern < junior < mid < senior < staff.
const SENIORITY_RANK: Record<string, number> = {
  intern: 0,
  junior: 1,
  mid: 2,
  senior: 3,
  staff: 4,
}

// ─── URL builder ─────────────────────────────────────────────────────────────

export function buildSearchUrl(term: string, filters: SearchFilters, page: number): string {
  const params = new URLSearchParams()
  if (term) params.set('sc.keyword', term)
  if (filters.location) params.set('locKeyword', filters.location)
  if (filters.recency && RECENCY_MAP[filters.recency]) params.set('fromAge', RECENCY_MAP[filters.recency])
  if (filters.workTypes?.includes('remote')) params.set('remoteWorkType', '1')
  if (filters.seniorities?.length) {
    if (filters.seniorities.length === 1) {
      const mapped = SENIORITY_MAP[filters.seniorities[0]]
      if (mapped) params.set('seniorityType', mapped)
    } else {
      // Multiple: pick the median rank to avoid over-filtering
      const sorted = [...filters.seniorities].sort(
        (a, b) => SENIORITY_RANK[a] - SENIORITY_RANK[b],
      )
      const median = sorted[Math.floor(sorted.length / 2)]
      const mapped = SENIORITY_MAP[median]
      if (mapped) params.set('seniorityType', mapped)
    }
  }
  if (page > 0) params.set('p', String(page + 1))
  return `https://www.glassdoor.com/Job/jobs.htm?${params.toString()}`
}

// ─── URL cleaner ──────────────────────────────────────────────────────────────

/**
 * Returns a canonical Glassdoor job URL, stripping tracking params.
 * Handles any Glassdoor TLD (glassdoor.com, glassdoor.ca, glassdoor.co.uk, etc.).
 */
export function cleanJobUrl(href: string): string {
  try {
    const base = href.startsWith('/') ? 'https://www.glassdoor.com' : undefined
    const u = new URL(href, base)
    if (u.hostname && !u.hostname.includes('glassdoor.')) return href
    // Partner tracking URLs carry jobListingId — convert to canonical form
    if (u.pathname.includes('/partner/jobListing')) {
      const jl = u.searchParams.get('jobListingId')
      if (jl) return `https://www.glassdoor.com/job-listing/-JL${jl}.htm?jl=${jl}`
    }
    // Glassdoor requires the jl= param to render the job page; strip all other tracking params
    const jl = u.searchParams.get('jl')
    const base2 = `https://www.glassdoor.com${u.pathname}`
    return jl ? `${base2}?jl=${jl}` : base2
  } catch {
    return href
  }
}

// ─── Parsing helpers ──────────────────────────────────────────────────────────

/**
 * Parses relative date text ("3 days ago", "Just now", "Today") into YYYY-MM-DD.
 * Returns null for "30+ days ago" or unrecognised text.
 */
export function parsePostedAt(text: string): string | null {
  const normalised = text.trim().toLowerCase()
  if (!normalised) return null
  if (normalised === 'just now' || normalised === 'today' || normalised === 'just posted') {
    return new Date().toISOString().slice(0, 10)
  }
  if (/30\+/.test(normalised)) return null

  const m = normalised.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/)
  if (!m) return null

  const n = parseInt(m[1], 10)
  const unit = m[2]
  const d = new Date()

  switch (unit) {
    case 'second': d.setSeconds(d.getSeconds() - n); break
    case 'minute': d.setMinutes(d.getMinutes() - n); break
    case 'hour':   d.setHours(d.getHours() - n); break
    case 'day':    d.setDate(d.getDate() - n); break
    case 'week':   d.setDate(d.getDate() - n * 7); break
    case 'month':  d.setMonth(d.getMonth() - n); break
    case 'year':   d.setFullYear(d.getFullYear() - n); break
  }

  return d.toISOString().slice(0, 10)
}

/**
 * Parses Glassdoor salary text into annual USD integer range.
 *
 * Handles:
 *   "$80K–$120K/yr"          → { salary_min: 80000, salary_max: 120000 }
 *   "Est. $90K/yr"           → { salary_min: 90000, salary_max: null }
 *   "Employer est.: $100K–$150K/yr" → { salary_min: 100000, salary_max: 150000 }
 *   "$45–$65/hr"             → { salary_min: 93600, salary_max: 135200 } (×2080)
 *   "$120K/yr"               → { salary_min: 120000, salary_max: null }
 */
export function parseSalary(text: string): { salary_min: number | null; salary_max: number | null } {
  if (!text || !text.trim()) return { salary_min: null, salary_max: null }

  const normalised = text
    .replace(/Employer est\.:\s*/i, '')
    .replace(/Est\.?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  const isHourly = /\/hr/i.test(normalised)
  const ANNUAL_MULTIPLIER = 2080 // 52 weeks × 40 hours

  // Extract one or two dollar amounts (handles K suffix and plain numbers)
  const amounts: number[] = []
  const moneyPattern = /\$(\d+(?:\.\d+)?)(K?)/gi
  let match: RegExpExecArray | null
  while ((match = moneyPattern.exec(normalised)) !== null) {
    let val = parseFloat(match[1])
    if (match[2].toUpperCase() === 'K') val *= 1000
    amounts.push(Math.round(val))
  }

  if (amounts.length === 0) return { salary_min: null, salary_max: null }

  let salary_min = amounts[0]
  let salary_max = amounts.length >= 2 ? amounts[1] : null

  if (isHourly) {
    salary_min = Math.round(salary_min * ANNUAL_MULTIPLIER)
    if (salary_max !== null) salary_max = Math.round(salary_max * ANNUAL_MULTIPLIER)
  }

  return { salary_min, salary_max }
}

/**
 * Parses a Glassdoor star rating string ("4.2", "3.5 ★") into a float.
 * Returns null for out-of-range or unparseable values.
 */
export function parseRating(text: string): number | null {
  if (!text || !text.trim()) return null
  const m = text.trim().match(/^(\d+(?:\.\d+)?)/)
  if (!m) return null
  const val = parseFloat(m[1])
  if (isNaN(val) || val < 1 || val > 5) return null
  return val
}

// ─── Card extraction ──────────────────────────────────────────────────────────

export interface RawCard {
  href: string | null
  title: string | null
  company: string | null
  location: string
  postedText: string
  salaryText: string
  ratingText: string
}

/**
 * Extracts all job-listing cards from the current search page in a single
 * page.evaluate() call to avoid stale ElementHandle issues.
 *
 * Uses multiple layered fallbacks for each field because Glassdoor's DOM
 * changes frequently and varies by region/TLD. The container selector
 * [data-test="jobListing"] is matched first; if inner attribute-based
 * selectors miss, we fall back to href-pattern and class-fragment matching.
 */
export async function extractCards(page: Page): Promise<RawCard[]> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = (globalThis as any).document

    // ── Find card containers ───────────────────────────────────────────────
    const containerSelectors = [
      '[data-test="jobListing"]',
      'li.react-job-listing',
      'li[data-jobid]',
      'li[data-job-id]',
    ]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let cards: any[] = []
    for (const sel of containerSelectors) {
      try {
        const found = Array.from(doc.querySelectorAll(sel))
        if (found.length > 0) { cards = found; break }
      } catch { /* unsupported selector — try next */ }
    }

    // Last resort: collect unique ancestor li/article elements of job-listing links
    if (cards.length === 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const links: any[] = Array.from(doc.querySelectorAll('a[href*="/job-listing/"]'))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const seen = new Set<any>()
      for (const a of links) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let el: any = a
        while (el && el.tagName !== 'LI' && el.tagName !== 'ARTICLE' && el !== doc.body) {
          el = el.parentElement
        }
        if (el && !seen.has(el)) { seen.add(el); cards.push(el) }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return cards.map((card: any) => {
      // ── Title link — href is the canonical identifier ────────────────────
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const linkEl: any =
        card.querySelector('a[data-test="job-title"]') ??
        card.querySelector('a[id^="job-title"]') ??
        card.querySelector('a[href*="/job-listing/"]') ??
        card.querySelector('a[data-job-id]') ??
        card.querySelector('a[href*="/partner/jobListing"]') ??
        card.querySelector('a')

      // ── Title text ───────────────────────────────────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const titleEl: any =
        card.querySelector('[data-test="job-title"]') ??
        card.querySelector('[class*="JobCard_jobTitle"]') ??
        card.querySelector('[class*="jobTitle"]') ??
        card.querySelector('[class*="job-title"]') ??
        linkEl

      // ── Company name ─────────────────────────────────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const companyEl: any =
        card.querySelector('[data-test="employer-name"]') ??
        card.querySelector('[class*="EmployerProfile_compactEmployerName"]') ??
        card.querySelector('[class*="employer-name"]') ??
        card.querySelector('[class*="companyName"]') ??
        card.querySelector('[class*="EmployerProfile"]')

      // ── Location ─────────────────────────────────────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const locationEl: any =
        card.querySelector('[data-test="emp-location"]') ??
        card.querySelector('[class*="JobCard_location"]') ??
        card.querySelector('[class*="location"]')

      // ── Posted date ──────────────────────────────────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ageEl: any =
        card.querySelector('[data-test="job-age-label"]') ??
        card.querySelector('[class*="JobCard_listingAge"]') ??
        card.querySelector('[class*="listing-age"]') ??
        card.querySelector('time')

      // ── Salary ───────────────────────────────────────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const salaryEl: any =
        card.querySelector('[data-test="detailSalary"]') ??
        card.querySelector('[class*="JobCard_salaryEstimate"]') ??
        card.querySelector('[class*="salary-estimate"]') ??
        card.querySelector('[class*="Salary"]')

      // ── Company rating ───────────────────────────────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ratingEl: any =
        card.querySelector('[data-test="rating-info"]') ??
        card.querySelector('[class*="rating"]') ??
        card.querySelector('[class*="Rating"]')

      return {
        href: linkEl?.getAttribute('href') ?? null,
        title: titleEl?.textContent?.trim() ?? null,
        company: companyEl?.textContent?.trim() ?? null,
        location: locationEl?.textContent?.trim() ?? '',
        postedText: ageEl?.textContent?.trim() ?? '',
        salaryText: salaryEl?.textContent?.trim() ?? '',
        ratingText: ratingEl?.textContent?.trim() ?? '',
      }
    })
  })
}

const JOB_UNAVAILABLE_PATTERNS = [
  /\bjob is (out of order|ooo)\b/i,
  /\bthis job (is|has been) (closed|removed|expired|no longer available)\b/i,
  /\bno longer (available|accepting applications)\b/i,
  /\bposition (has been|is) (filled|closed)\b/i,
  /\bjob listing (is|has been) (removed|expired|closed)\b/i,
]

export interface ParsedDetail {
  raw_text: string | null
  salary_min: number | null
  salary_max: number | null
  company_rating: number | null
  jobUnavailable: boolean
}

export async function parseDetail(page: Page): Promise<ParsedDetail> {
  // Try every known description selector; fall back to the largest text block.
  const descSelectors = [
    SELECTORS.jobDescriptionContent,
    ...SELECTORS.jobDescriptionPage.split(',').map((s) => s.trim()),
  ]
  let raw_text: string | null = null
  for (const sel of descSelectors) {
    const el = await page.$(sel)
    if (el) {
      raw_text = (await el.innerText()).trim() || null
      if (raw_text) break
    }
  }
  // Last resort: dump all visible text on the page
  if (!raw_text) {
    raw_text = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((globalThis as any).document.body as any)?.innerText?.trim() ?? null
    }).catch(() => null)
  }

  const salaryEl =
    (await page.$(SELECTORS.detailSalary)) ??
    (await page.$(SELECTORS.detailSalaryAlt))
  const salaryText = (await salaryEl?.textContent())?.trim() ?? ''
  const { salary_min, salary_max } = parseSalary(salaryText)

  const ratingEl = await page.$(SELECTORS.detailRating)
  const ratingText = (await ratingEl?.textContent())?.trim() ?? ''
  const company_rating = parseRating(ratingText)

  const jobUnavailable = !!raw_text && JOB_UNAVAILABLE_PATTERNS.some((p) => p.test(raw_text!))

  return { raw_text: jobUnavailable ? null : raw_text, salary_min, salary_max, company_rating, jobUnavailable }
}

// ─── Auth wall helpers ────────────────────────────────────────────────────────

async function isCloudflareChallenge(page: Page): Promise<boolean> {
  const title = await page.title().catch(() => '')
  return title.toLowerCase().includes('just a moment')
}

async function dismissAuthWall(page: Page): Promise<boolean> {
  const hardsell = page.locator(SELECTORS.hardsellDialog)
  const loginModal = page.locator(SELECTORS.loginModal)

  const hardsellVisible = await hardsell.isVisible().catch(() => false)
  const loginVisible = await loginModal.isVisible().catch(() => false)

  if (!hardsellVisible && !loginVisible) return false

  await page.keyboard.press('Escape')
  await page.waitForTimeout(800)

  // Return true if the wall is still there after dismissal attempt
  const stillHardsell = await hardsell.isVisible().catch(() => false)
  const stillLogin = await loginModal.isVisible().catch(() => false)
  return stillHardsell || stillLogin
}

// ─── Delay helper ─────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class GlassdoorAdapter extends BaseAdapter {
  override readonly id = 'glassdoor'
  override readonly requiresChromium = true
  override readonly delayMs = 2500
  override readonly availableSignals = new Set(['recency', 'salary'])
  override readonly supportsLogin = true

  private _sharedBrowser: Browser | undefined = undefined

  override async beginLogin(): Promise<() => Promise<void>> {
    const browser = await chromium.launch({
      headless: false,
      args: ['--disable-blink-features=AutomationControlled'],
    })
    this._sharedBrowser = browser
    const page = await browser.newPage()
    await page.goto('https://www.glassdoor.com/profile/login_input.htm', {
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
    const detailPage = await context.newPage()
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

      const url = buildSearchUrl(term, filters, pageNum)
      await searchPage.goto(url, { waitUntil: 'load', timeout: 30_000 })

      // Cloudflare challenge — pause and wait for user to solve, then retry
      if (await isCloudflareChallenge(searchPage)) {
        console.warn('[glassdoor] Cloudflare challenge detected, pausing for user')
        if (onCaptchaRequired) {
          await onCaptchaRequired()
          await searchPage.reload({ waitUntil: 'load', timeout: 30_000 })
          if (await isCloudflareChallenge(searchPage)) {
            console.warn('[glassdoor] Cloudflare challenge still present after resume, aborting')
            break
          }
        } else {
          break
        }
      }

      // Wait for job listings to appear
      try {
        await searchPage.waitForSelector(SELECTORS.jobListing, { timeout: 15_000 })
      } catch {
        console.warn(`[glassdoor] no job listings found on page ${pageNum}, url: ${searchPage.url()}`)
        // If page 0 has no results, try without location filter as a fallback
        if (pageNum === 0 && filters.location) {
          console.info('[glassdoor] retrying without location filter')
          const fallbackUrl = buildSearchUrl(term, { ...filters, location: undefined }, 0)
          await searchPage.goto(fallbackUrl, { waitUntil: 'load', timeout: 30_000 })
          try {
            await searchPage.waitForSelector(SELECTORS.jobListing, { timeout: 10_000 })
          } catch {
            break
          }
        } else {
          break
        }
      }

      const rawCards = await extractCards(searchPage)
      if (rawCards.length === 0) break

      for (const raw of rawCards) {
        if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) return
        if (filters.maxResults != null && reportedCount >= filters.maxResults) return

        if (!raw.href || !raw.title || !raw.company) {
          // Selector miss — skip silently without counting as a parse failure.
          // consecutiveFails is reserved for cards that have a URL but fail to
          // fully process, indicating an adapter-level problem.
          console.warn(`[glassdoor] card missing required fields — href:${raw.href} title:${raw.title} company:${raw.company}`)
          continue
        }

        const jobUrl = cleanJobUrl(raw.href)
        // Resolve the raw href to an absolute URL for navigation — preserves
        // the jl= query param and TLD that Glassdoor requires to render the job.
        const rawAbsoluteHref = raw.href.startsWith('http')
          ? raw.href
          : `https://www.glassdoor.com${raw.href}`
        const posted_at = parsePostedAt(raw.postedText)

        const { salary_min: cardSalaryMin, salary_max: cardSalaryMax } = parseSalary(raw.salaryText)
        const cardRating = parseRating(raw.ratingText)
        let salary_min = cardSalaryMin
        let salary_max = cardSalaryMax
        let company_rating = cardRating

        // Navigate the detail page to the job URL to fetch the full description.
        // The search page stays untouched — no click interception, no back-navigation.
        let raw_text: string | null = null
        try {
          await detailPage.goto(rawAbsoluteHref, {
            waitUntil: 'domcontentloaded',
            timeout: 8_000,
            referer: searchPage.url(),
          })

          await detailPage.waitForSelector(
            `${SELECTORS.jobDescriptionContent}, ${SELECTORS.jobDescriptionPage}`,
            { timeout: 3_000 },
          )

          const showMoreBtn = await detailPage.$(SELECTORS.showMore)
          if (showMoreBtn) {
            await showMoreBtn.click().catch(() => {})
            await detailPage.waitForTimeout(150)
          }

          const wallPersists = await dismissAuthWall(detailPage)
          if (wallPersists) {
            console.warn('[glassdoor] auth wall on detail page, pausing for user')
            if (onCaptchaRequired) {
              await onCaptchaRequired()
              // Retry dismissal after user interaction
              const stillPersists = await dismissAuthWall(detailPage)
              if (stillPersists) {
                console.warn('[glassdoor] auth wall persists after resume, returning partial results')
                return
              }
            } else {
              return
            }
          }

          const detail = await parseDetail(detailPage)

          if (detail.jobUnavailable) {
            console.warn(`[glassdoor] job no longer available, skipping: ${jobUrl}`)
            consecutiveFails = 0
            continue
          }
          raw_text = detail.raw_text

          if (detail.salary_min !== null || detail.salary_max !== null) {
            salary_min = detail.salary_min
            salary_max = detail.salary_max
          }
          if (detail.company_rating !== null) {
            company_rating = detail.company_rating
          }
        } catch (err) {
          console.log(`[glassdoor] detail page failed (${err instanceof Error ? err.message.split('\n')[0] : String(err)}), using card data`)
        }

        const { yoe_min, yoe_max } = extractYoe(raw_text ?? raw.title)
        const seniority = extractSeniority(raw.title, raw_text ?? '')
        const tech_stack = extractTechStack(raw_text ?? raw.title)

        onPosting?.({
          source: SOURCE,
          url: jobUrl,
          resolved_domain: null,
          title: raw.title,
          company: raw.company,
          location: raw.location,
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
          salary_min,
          salary_max,
          company_rating,
        })
        reportedCount++
        consecutiveFails = 0

        // Pause between detail page requests to avoid rate-limiting.
        // Jitter spreads requests so they don't look metronomic.
        const jitter = Math.floor(Math.random() * 1000)
        await delay(this.delayMs + jitter)
      }

      // Check if there's a next page
      const nextBtn = searchPage.locator(SELECTORS.paginationNext)
      const nextDisabled = await nextBtn.getAttribute('disabled').catch(() => 'true')
      if (nextDisabled !== null) break

      await delay(3000) // pause before loading next page
    }
  }
}

export default GlassdoorAdapter
