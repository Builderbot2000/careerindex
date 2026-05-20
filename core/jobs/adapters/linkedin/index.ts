import { chromium, type Browser, type BrowserContext, type ElementHandle, type Page } from 'playwright'
import { BaseAdapter, type JobPosting, type SearchFilters, type Seniority, type CrawlSignal } from '../base'

const SOURCE = 'linkedin'
const SCRAPER_VERSION = 'linkedin-adapter@1'

/** Maximum search-result pages to fetch per search term (25 cards per page). */
const MAX_PAGES = 3
const PAGE_SIZE = 25

/** Abort a search term after this many consecutive card-level parse failures. */
const MAX_CONSECUTIVE_FAILS = 5

// ─── Selectors ────────────────────────────────────────────────────────────────
// Centralised here so they are easy to update when LinkedIn's DOM changes.

export const SELECTORS = {
  // Search results list (public / guest page)
  resultsList: 'ul.jobs-search__results-list',
  resultItem: 'ul.jobs-search__results-list > li',
  cardLink: 'a.base-card__full-link',
  cardTitle: 'h3.base-search-card__title',
  cardCompany: 'h4.base-search-card__subtitle',
  cardLocation: 'span.job-search-card__location',
  cardPostedAt: 'time.job-search-card__listdate',
  // Job detail page
  detailDescription: '.show-more-less-html__markup',
  detailDescriptionFallback: '.description__text--rich',
  detailApplicantCount: '.num-applicants__caption',
  detailShowMore: 'button.show-more-less-html__button--more',
} as const

// ─── Known tech keyword list ──────────────────────────────────────────────────
// Used for tech_stack extraction from raw_text. Ordered longest-first so that
// "Next.js" is matched before "JS" when both appear in a description.

export const KNOWN_TECH: string[] = [
  'TypeScript', 'JavaScript', 'Python', 'Ruby', 'Kotlin', 'Swift',
  'Scala', 'Clojure', 'Elixir', 'Haskell', 'C++', 'C#', '.NET',
  'Java', 'Rust', 'Go', 'PHP',
  'Next.js', 'Nuxt.js', 'SvelteKit', 'NestJS', 'Fastify', 'Express',
  'React', 'Vue', 'Angular', 'Svelte', 'Solid',
  'Node.js', 'Django', 'Flask', 'FastAPI', 'Rails', 'Spring', 'Laravel',
  'PostgreSQL', 'MySQL', 'SQLite', 'MongoDB', 'Redis', 'Elasticsearch',
  'Cassandra', 'DynamoDB', 'CockroachDB', 'ClickHouse',
  'Kubernetes', 'Docker', 'Terraform', 'Pulumi', 'Ansible',
  'AWS', 'GCP', 'Azure', 'Cloudflare', 'Vercel', 'Fly.io',
  'GitHub Actions', 'CI/CD', 'GraphQL', 'gRPC', 'REST',
  'Kafka', 'RabbitMQ', 'NATS',
  'Prometheus', 'Grafana', 'Datadog',
  'PyTorch', 'TensorFlow', 'scikit-learn', 'LangChain', 'OpenAI',
  'WebSockets', 'WebAssembly', 'Nginx', 'Linux', 'Bash', 'Git',
  'Tailwind', 'CSS', 'HTML',
]

// ─── URL helpers ──────────────────────────────────────────────────────────────

const SENIORITY_MAP: Record<string, string> = {
  intern: '1',
  junior: '2',
  mid: '3',
  senior: '4',
  staff: '5',
}

const WORK_TYPE_MAP: Record<string, string> = {
  onsite: '1',
  remote: '2',
  hybrid: '3',
}

const RECENCY_MAP: Record<string, string> = {
  day: 'r86400',
  week: 'r604800',
  month: 'r2592000',
}

export function buildSearchUrl(term: string, filters: SearchFilters, start: number): string {
  const params = new URLSearchParams()
  if (term) params.set('keywords', term)
  if (filters.location) params.set('location', filters.location)
  if (filters.seniorities?.length) {
    const codes = filters.seniorities.map((s) => SENIORITY_MAP[s]).filter(Boolean)
    if (codes.length) params.set('f_E', codes.join(','))
  }
  if (filters.workTypes?.length) {
    const codes = filters.workTypes.map((w) => WORK_TYPE_MAP[w]).filter(Boolean)
    if (codes.length) params.set('f_WT', codes.join(','))
  }
  if (filters.recency && RECENCY_MAP[filters.recency]) params.set('f_TPR', RECENCY_MAP[filters.recency])
  params.set('start', String(start))
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`
}

/**
 * Strips all query-string parameters from a LinkedIn job URL so we store the
 * canonical path (`https://www.linkedin.com/jobs/view/<id>/`) rather than one
 * decorated with tracking tokens.
 */
export function cleanJobUrl(href: string): string {
  try {
    const base = href.startsWith('/') ? 'https://www.linkedin.com' : undefined
    const u = new URL(href, base)
    return `${u.origin}${u.pathname}`
  } catch {
    return href
  }
}

// ─── Parsing helpers ──────────────────────────────────────────────────────────

export function parsePostedAt(datetimeAttr: string | null, textContent: string): string | null {
  // Prefer the machine-readable datetime attribute when present.
  if (datetimeAttr) {
    const d = new Date(datetimeAttr)
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  }

  // Fall back to parsing relative text like "3 days ago", "2 weeks ago".
  const m = textContent.toLowerCase().match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/)
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

export function parseApplicantCount(text: string): number | null {
  // "Over 200 applicants", "Be among the first 25 applicants", "1,234 applicants"
  const normalised = text.replace(/,/g, '')
  const m = normalised.match(/(\d+)\s+applicant/i)
  if (m) return parseInt(m[1], 10)
  const over = normalised.match(/over\s+(\d+)/i)
  if (over) return parseInt(over[1], 10)
  return null
}

export function extractYoe(text: string): { yoe_min: number | null; yoe_max: number | null } {
  // "5+ years", "5 or more years"
  const plus = text.match(/(\d+)\+\s*years?/i) ?? text.match(/(\d+)\s+or\s+more\s+years?/i)
  if (plus) return { yoe_min: parseInt(plus[1], 10), yoe_max: null }

  // "3-5 years", "3 to 5 years", "3–5 years"
  const range = text.match(/(\d+)\s*[-–to ]+\s*(\d+)\s*years?/i)
  if (range) return { yoe_min: parseInt(range[1], 10), yoe_max: parseInt(range[2], 10) }

  // "at least 3 years"
  const atleast = text.match(/at\s+least\s+(\d+)\s+years?/i)
  if (atleast) return { yoe_min: parseInt(atleast[1], 10), yoe_max: null }

  return { yoe_min: null, yoe_max: null }
}

export function extractSeniority(title: string, rawText: string): Seniority {
  const combined = `${title} ${rawText}`.toLowerCase()
  if (/\bintern\b/.test(combined)) return 'intern'
  if (/\bjunior\b|\bentry[\s-]level\b|\bjr\.?\b/.test(combined)) return 'junior'
  if (/\bstaff\b|\bprincipal\b|\bdistinguished\b/.test(combined)) return 'staff'
  if (/\bsenior\b|\bsr\.?\b/.test(combined)) return 'senior'
  if (/\bmid[\s-]level\b|\bintermediate\b/.test(combined)) return 'mid'
  return 'any'
}

export function extractTechStack(text: string): string[] {
  const found: string[] = []
  for (const tech of KNOWN_TECH) {
    // Build a word-boundary–aware pattern. Allow internal dots (e.g. "Node.js").
    const escaped = tech.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`(?<![\\w.])${escaped}(?![\\w.])`, 'i')
    if (pattern.test(text)) found.push(tech)
  }
  return found
}

// ─── DOM parsers (exported for integration testing) ───────────────────────────

export interface ParsedCard {
  href: string
  title: string
  company: string
  location: string
  posted_at: string | null
}

/** Returns null when required card fields (href, title, company) are missing. */
export async function parseCard(card: ElementHandle): Promise<ParsedCard | null> {
  const linkEl     = await card.$(SELECTORS.cardLink)
  const titleEl    = await card.$(SELECTORS.cardTitle)
  const companyEl  = await card.$(SELECTORS.cardCompany)
  const locationEl = await card.$(SELECTORS.cardLocation)
  const timeEl     = await card.$(SELECTORS.cardPostedAt)

  const href    = await linkEl?.getAttribute('href') ?? null
  const title   = (await titleEl?.textContent())?.trim() ?? null
  const company = (await companyEl?.textContent())?.trim() ?? null
  const location = (await locationEl?.textContent())?.trim() ?? ''

  const dateAttr = await timeEl?.getAttribute('datetime') ?? null
  const dateText = (await timeEl?.textContent())?.trim() ?? ''
  const posted_at = parsePostedAt(dateAttr, dateText)

  if (!href || !title || !company) return null
  return { href, title, company, location, posted_at }
}

export interface ParsedDetail {
  raw_text: string | null
  applicant_count: number | null
}

export async function parseDetail(page: Page): Promise<ParsedDetail> {
  const descEl =
    (await page.$(SELECTORS.detailDescription)) ??
    (await page.$(SELECTORS.detailDescriptionFallback))
  const raw_text = descEl ? (await descEl.innerText()).trim() : null

  const appEl = await page.$(SELECTORS.detailApplicantCount)
  const appText = (await appEl?.textContent())?.trim() ?? null
  const applicant_count = appText ? parseApplicantCount(appText) : null

  return { raw_text, applicant_count }
}

// ─── Challenge / captcha detection ──────────────────────────────────────────

async function isChallengeOrCaptcha(page: Page): Promise<boolean> {
  const title = (await page.title().catch(() => '')).toLowerCase()
  if (
    title.includes('security check') ||
    title.includes('captcha') ||
    title.includes('verify you are human') ||
    title.includes('just a moment')
  ) return true
  const hasCaptchaEl = await page
    .$('#captcha-internal, iframe[src*="captcha"], [data-challenge]')
    .then((el) => el !== null)
    .catch(() => false)
  return hasCaptchaEl
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class LinkedInAdapter extends BaseAdapter {
  override readonly id = 'linkedin'
  override readonly requiresChromium = true
  override readonly delayMs = 3000
  override readonly availableSignals = new Set(['recency', 'applicant_count'])

  override async search(
    term: string,
    filters: SearchFilters,
    onPosting?: (posting: Omit<JobPosting, 'id'>) => void,
    onCaptchaRequired?: () => Promise<void>,
    signal?: CrawlSignal,
  ): Promise<void> {
    const browser = await chromium.launch({
      headless: false,
      args: ['--disable-blink-features=AutomationControlled'],
    })
    try {
      await this._scrape(browser, term, filters, onPosting, onCaptchaRequired, signal)
    } finally {
      await browser.close()
    }
  }

  private async _scrape(
    browser: Browser,
    term: string,
    filters: SearchFilters,
    onPosting?: (posting: Omit<JobPosting, 'id'>) => void,
    onCaptchaRequired?: () => Promise<void>,
    signal?: CrawlSignal,
  ): Promise<void> {
    const context: BrowserContext = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    })
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false })
    })
    const searchPage = await context.newPage()
    const detailPage = await context.newPage()
    let consecutiveFails = 0
    let reportedCount = 0
    const now = new Date().toISOString()
    const pageLimit = filters.maxResults != null
      ? Math.min(Math.ceil(filters.maxResults / PAGE_SIZE), MAX_PAGES)
      : MAX_PAGES

    try {
      for (let pageNum = 0; pageNum < pageLimit; pageNum++) {
        await signal?.waitForResume()
        signal?.checkAborted()

        const url = buildSearchUrl(term, filters, pageNum * PAGE_SIZE)
        const tPage = Date.now()
        await searchPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        process.stdout.write(`[linkedin] page ${pageNum} loaded in ${Date.now()-tPage}ms\n`)

        // Pause for user to solve captcha/security challenge if detected.
        if (await isChallengeOrCaptcha(searchPage)) {
          console.warn(`[linkedin] challenge detected on page ${pageNum}, pausing for user`)
          if (onCaptchaRequired) {
            await onCaptchaRequired()
            // Retry the navigation after user clears the challenge
            await searchPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
            if (await isChallengeOrCaptcha(searchPage)) {
              console.warn('[linkedin] challenge persists after resume, aborting')
              break
            }
          } else {
            break
          }
        }

        // Wait for the results list; break if no results are returned.
        try {
          await searchPage.waitForSelector(SELECTORS.resultsList, { timeout: 10_000 })
        } catch {
          break
        }

        const cards = await searchPage.$$(SELECTORS.resultItem)
        process.stdout.write(`[linkedin] page ${pageNum} got ${cards.length} cards\n`)
        if (cards.length === 0) break

        for (const card of cards) {
          if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
            // Enough consecutive failures on this adapter — stop.
            return
          }

          // ── Card-level fields ──────────────────────────────────────────────

          const tJob = Date.now()
          const parsed = await parseCard(card)
          if (!parsed) {
            consecutiveFails++
            continue
          }

          const { href, title, company, location, posted_at } = parsed
          const jobUrl = cleanJobUrl(href)

          // ── Detail page: raw_text + applicant_count ────────────────────────

          await delay(this.delayMs)
          process.stdout.write(`[linkedin] [+${Date.now()-tJob}ms] delay done — fetching ${jobUrl}\n`)

          let raw_text: string | null = null
          let applicant_count: number | null = null

          try {
            await detailPage.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
            process.stdout.write(`[linkedin] [+${Date.now()-tJob}ms] detail page loaded\n`)
            await detailPage.waitForTimeout(600)
            await detailPage.keyboard.press('Escape')
            await detailPage.waitForTimeout(300)
            const showMoreBtn = await detailPage.$(SELECTORS.detailShowMore)
            if (showMoreBtn) {
              await showMoreBtn.click().catch(() => {})
              await detailPage.waitForTimeout(300)
            }
            const detail = await parseDetail(detailPage)
            raw_text = detail.raw_text
            applicant_count = detail.applicant_count
            process.stdout.write(`[linkedin] [+${Date.now()-tJob}ms] detail parsed, raw_text ${raw_text ? `${raw_text.length} chars` : 'null'}\n`)
          } catch {
            process.stdout.write(`[linkedin] [+${Date.now()-tJob}ms] detail fetch failed, using card data\n`)
          }

          // ── Derived fields ─────────────────────────────────────────────────

          const { yoe_min, yoe_max } = extractYoe(raw_text ?? '')
          const seniority = extractSeniority(title, raw_text ?? '')
          const tech_stack = extractTechStack(raw_text ?? title)

          onPosting?.({
            source: SOURCE,
            url: jobUrl,
            resolved_domain: null,
            title,
            company,
            location,
            yoe_min,
            yoe_max,
            seniority,
            tech_stack,
            posted_at,
            applicant_count,
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

          if (filters.maxResults != null && reportedCount >= filters.maxResults) return
        }

        // Fewer cards than expected means we've reached the last page.
        if (cards.length < PAGE_SIZE) break
      }
    } finally {
      await searchPage.close()
      await detailPage.close()
      await context.close()
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export default LinkedInAdapter
