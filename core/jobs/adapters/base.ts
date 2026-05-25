import { z } from 'zod'

// ─── Status + Seniority enums ─────────────────────────────────────────────────

export const PostingStatusSchema = z.enum([
  'new',
  'viewed',
  'favorited',
  'applied',
  'interviewing',
  'offer',
  'rejected',
  'ghosted',
])

export const SenioritySchema = z.enum(['intern', 'junior', 'mid', 'senior', 'staff', 'any'])

export type PostingStatus = z.infer<typeof PostingStatusSchema>
export type Seniority = z.infer<typeof SenioritySchema>

// ─── JobPosting — the interface contract ─────────────────────────────────────

export const JobPostingSchema = z.object({
  id: z.string().uuid(),
  source: z.string(),
  url: z.string().url(),
  resolved_domain: z.string().nullable(),
  title: z.string().min(1),
  company: z.string().min(1),
  location: z.string(),
  yoe_min: z.number().int().nullable(),
  yoe_max: z.number().int().nullable(),
  seniority: SenioritySchema,
  tech_stack: z.array(z.string()),
  posted_at: z.string().nullable(),
  applicant_count: z.number().int().nullable(),
  raw_text: z.string().nullable(),
  fetched_at: z.string(),
  scraper_mod_version: z.string(),
  status: PostingStatusSchema,
  affinity_score: z.number().nullable(),
  affinity_skipped: z.boolean(),
  affinity_scored_at: z.string().nullable(),
  affinity_reasoning: z.string().nullable(),
  description_snippet: z.string().nullable(),
  hard_reqs_class: z.enum(['overqualified', 'fully_qualified', 'minimally_qualified', 'underqualified']).nullable(),
  nice_to_haves_class: z.enum(['fully_met', 'partially_met', 'not_met']).nullable(),
  first_response_at: z.string().nullable(),
  last_seen_at: z.string(),
  salary_min: z.number().int().nullable(),
  salary_max: z.number().int().nullable(),
  company_rating: z.number().nullable(),
  archived_at: z.string().nullable().optional(),
  required_seniorities: z.array(SenioritySchema).nullable().optional(),
})

export type JobPosting = z.infer<typeof JobPostingSchema>

// ─── DB row shape (SQLite integers and JSON strings, pre-conversion) ──────────

export interface JobPostingRow {
  id: string
  source: string
  url: string
  resolved_domain: string | null
  title: string
  company: string
  location: string
  yoe_min: number | null
  yoe_max: number | null
  seniority: string
  tech_stack: string        // JSON array
  posted_at: string | null
  applicant_count: number | null
  raw_text: string | null
  fetched_at: string
  scraper_mod_version: string
  status: string
  affinity_score: number | null
  affinity_skipped: number  // SQLite integer 0/1
  affinity_scored_at: string | null
  affinity_reasoning: string | null
  description_snippet: string | null
  hard_reqs_class: string | null
  nice_to_haves_class: string | null
  first_response_at: string | null
  last_seen_at: string
  salary_min: number | null
  salary_max: number | null
  company_rating: number | null
  applied_at?: string | null
  archived_at?: string | null
  required_seniorities?: string | null  // JSON array
}

export function rowToPosting(row: JobPostingRow): JobPosting {
  let required_seniorities: Seniority[] | null = null
  if (row.required_seniorities) {
    try {
      const parsed = JSON.parse(row.required_seniorities) as unknown
      if (Array.isArray(parsed)) required_seniorities = parsed as Seniority[]
    } catch { /* leave null */ }
  }
  return {
    ...row,
    seniority: row.seniority as Seniority,
    status: row.status as PostingStatus,
    tech_stack: JSON.parse(row.tech_stack) as string[],
    affinity_skipped: row.affinity_skipped === 1,
    hard_reqs_class: row.hard_reqs_class as JobPosting['hard_reqs_class'],
    nice_to_haves_class: row.nice_to_haves_class as JobPosting['nice_to_haves_class'],
    required_seniorities,
  }
}

// ─── Crawl control ───────────────────────────────────────────────────────────

export interface CrawlSignal {
  readonly aborted: boolean
  /** Resolves immediately when running; awaits resume() call when paused. */
  waitForResume(): Promise<void>
  /** Throws if the crawl has been aborted. */
  checkAborted(): void
}

export interface CrawlController {
  readonly signal: CrawlSignal
  pause(): void
  resume(): void
  abort(): void
}

// ─── Adapter interface ────────────────────────────────────────────────────────

export interface SearchFilters {
  location?: string
  seniorities?: Array<'intern' | 'junior' | 'mid' | 'senior' | 'staff'>
  workTypes?: Array<'remote' | 'hybrid' | 'onsite'>
  recency?: 'day' | 'week' | 'month'
  maxResults?: number
}

export abstract class BaseAdapter {
  abstract readonly id: string
  readonly delayMs: number = 3000
  readonly availableSignals: Set<string> = new Set()
  readonly supportsLogin: boolean = false
  readonly requiresChromium: boolean = false
  /** When true, the adapter ignores the search term and runs only once per scrape. */
  readonly ignoresTerm: boolean = false

  /**
   * Opens a browser to the site's login page and stores it for reuse across
   * search() calls. Returns a cleanup function that closes the browser.
   * Only called when supportsLogin is true and the user opted in.
   */
  beginLogin(): Promise<() => Promise<void>> {
    return Promise.resolve(async () => {})
  }

  abstract search(
    term: string,
    filters: SearchFilters,
    onPosting?: (posting: Omit<JobPosting, 'id'>) => void,
    onCaptchaRequired?: () => Promise<void>,
    signal?: CrawlSignal,
  ): Promise<void>
}
