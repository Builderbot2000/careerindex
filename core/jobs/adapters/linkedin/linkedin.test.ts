import { describe, it, expect } from 'vitest'
import {
  cleanJobUrl,
  buildSearchUrl,
  parsePostedAt,
  parseApplicantCount,
  extractYoe,
  extractSeniority,
  extractTechStack,
} from './index'

// ─── cleanJobUrl ──────────────────────────────────────────────────────────────

describe('cleanJobUrl', () => {
  it('strips tracking query params from a full URL', () => {
    const result = cleanJobUrl(
      'https://www.linkedin.com/jobs/view/123/?refId=abc&trackingId=xyz',
    )
    expect(result).toBe('https://www.linkedin.com/jobs/view/123/')
  })

  it('expands a relative path to a full linkedin.com URL', () => {
    const result = cleanJobUrl('/jobs/view/123/')
    expect(result).toBe('https://www.linkedin.com/jobs/view/123/')
  })

  it('leaves an already-clean URL unchanged', () => {
    const url = 'https://www.linkedin.com/jobs/view/123/'
    expect(cleanJobUrl(url)).toBe(url)
  })

  it('returns an unparseable string as-is', () => {
    expect(cleanJobUrl('not-a-url')).toBe('not-a-url')
  })
})

// ─── buildSearchUrl ───────────────────────────────────────────────────────────

describe('buildSearchUrl', () => {
  it('includes keywords param for a term', () => {
    const url = buildSearchUrl('typescript engineer', {}, 0)
    expect(url).toContain('keywords=typescript+engineer')
  })

  it('includes location param when provided', () => {
    const url = buildSearchUrl('engineer', { location: 'San Francisco' }, 0)
    expect(url).toContain('location=San+Francisco')
  })

  it('includes f_WT=2 for remote filter', () => {
    const url = buildSearchUrl('engineer', { workTypes: ['remote'] }, 0)
    expect(url).toContain('f_WT=2')
  })

  it('reflects pagination start offset', () => {
    const url = buildSearchUrl('engineer', {}, 25)
    expect(url).toContain('start=25')
  })

  it('includes all params when all filters are set', () => {
    const url = buildSearchUrl('engineer', { location: 'NYC', workTypes: ['remote'] }, 50)
    expect(url).toContain('keywords=engineer')
    expect(url).toContain('location=NYC')
    expect(url).toContain('f_WT=2')
    expect(url).toContain('start=50')
  })
})

// ─── parsePostedAt ────────────────────────────────────────────────────────────

describe('parsePostedAt', () => {
  const today = new Date().toISOString().slice(0, 10)

  it('returns ISO date from a valid datetime attribute', () => {
    expect(parsePostedAt('2024-03-15', 'anything')).toBe('2024-03-15')
  })

  it('falls back to relative text when datetime attr is null', () => {
    const result = parsePostedAt(null, '3 days ago')
    const expected = new Date()
    expected.setUTCDate(expected.getUTCDate() - 3)
    expect(result).toBe(expected.toISOString().slice(0, 10))
  })

  it('parses "2 weeks ago"', () => {
    const result = parsePostedAt(null, '2 weeks ago')
    const expected = new Date()
    expected.setUTCDate(expected.getUTCDate() - 14)
    expect(result).toBe(expected.toISOString().slice(0, 10))
  })

  it('parses "1 month ago"', () => {
    const result = parsePostedAt(null, '1 month ago')
    const expected = new Date()
    expected.setUTCMonth(expected.getUTCMonth() - 1)
    expect(result).toBe(expected.toISOString().slice(0, 10))
  })

  it('parses "2 years ago"', () => {
    const result = parsePostedAt(null, '2 years ago')
    const expected = new Date()
    expected.setUTCFullYear(expected.getUTCFullYear() - 2)
    expect(result).toBe(expected.toISOString().slice(0, 10))
  })

  it('returns null when both attr and text are empty', () => {
    expect(parsePostedAt(null, '')).toBeNull()
  })

  it('falls back to text when datetime attr is invalid', () => {
    const result = parsePostedAt('invalid-date', '1 hour ago')
    // Compute the same way parsePostedAt does so the test stays correct when
    // the current UTC time is within an hour of midnight (in which case
    // "1 hour ago" rolls into the previous UTC day).
    const expected = new Date()
    expected.setUTCHours(expected.getUTCHours() - 1)
    expect(result).toBe(expected.toISOString().slice(0, 10))
  })
})

// ─── parseApplicantCount ──────────────────────────────────────────────────────

describe('parseApplicantCount', () => {
  it('parses "Over 200 applicants"', () => {
    expect(parseApplicantCount('Over 200 applicants')).toBe(200)
  })

  it('parses "Be among the first 25 applicants"', () => {
    expect(parseApplicantCount('Be among the first 25 applicants')).toBe(25)
  })

  it('parses comma-formatted "1,234 applicants"', () => {
    expect(parseApplicantCount('1,234 applicants')).toBe(1234)
  })

  it('is case-insensitive for "over"', () => {
    expect(parseApplicantCount('over 500 applicants')).toBe(500)
  })

  it('returns null when no match', () => {
    expect(parseApplicantCount('No applicant info')).toBeNull()
  })
})

// ─── extractYoe ───────────────────────────────────────────────────────────────

describe('extractYoe', () => {
  it('parses "5+ years"', () => {
    expect(extractYoe('5+ years experience')).toEqual({ yoe_min: 5, yoe_max: null })
  })

  it('parses "5 or more years"', () => {
    expect(extractYoe('5 or more years required')).toEqual({ yoe_min: 5, yoe_max: null })
  })

  it('parses hyphen range "3-5 years"', () => {
    expect(extractYoe('3-5 years of experience')).toEqual({ yoe_min: 3, yoe_max: 5 })
  })

  it('parses "3 to 5 years"', () => {
    expect(extractYoe('3 to 5 years')).toEqual({ yoe_min: 3, yoe_max: 5 })
  })

  it('parses em-dash range "3–5 years"', () => {
    expect(extractYoe('3–5 years')).toEqual({ yoe_min: 3, yoe_max: 5 })
  })

  it('parses "at least 3 years"', () => {
    expect(extractYoe('at least 3 years of experience')).toEqual({ yoe_min: 3, yoe_max: null })
  })

  it('returns nulls when no YOE pattern found', () => {
    expect(extractYoe('great communication skills')).toEqual({ yoe_min: null, yoe_max: null })
  })
})

// ─── extractSeniority ─────────────────────────────────────────────────────────

describe('extractSeniority', () => {
  it('detects intern', () => {
    expect(extractSeniority('Software Intern', '')).toBe('intern')
  })

  it('detects junior from title', () => {
    expect(extractSeniority('Junior Engineer', '')).toBe('junior')
  })

  it('detects junior from "entry-level" in raw text', () => {
    expect(extractSeniority('Software Engineer', 'entry-level role')).toBe('junior')
  })

  it('detects staff from title', () => {
    expect(extractSeniority('Staff Engineer', '')).toBe('staff')
  })

  it('detects staff from "principal" in raw text', () => {
    expect(extractSeniority('Engineer', 'principal engineer track')).toBe('staff')
  })

  it('detects senior from title', () => {
    expect(extractSeniority('Senior Software Engineer', '')).toBe('senior')
  })

  it('detects senior from "Sr." abbreviation', () => {
    expect(extractSeniority('Sr. Engineer', '')).toBe('senior')
  })

  it('detects mid from "mid-level" in raw text', () => {
    expect(extractSeniority('Software Engineer', 'mid-level position')).toBe('mid')
  })

  it('detects mid from "intermediate" in raw text', () => {
    expect(extractSeniority('Engineer', 'intermediate experience required')).toBe('mid')
  })

  it('returns "any" when no seniority signal present', () => {
    expect(extractSeniority('Software Engineer', '')).toBe('any')
  })

  it('intern takes priority over senior when both present', () => {
    expect(extractSeniority('Senior Intern Program', '')).toBe('intern')
  })
})

// ─── extractTechStack ─────────────────────────────────────────────────────────

describe('extractTechStack', () => {
  it('extracts multiple techs from a description', () => {
    const result = extractTechStack('Experience with TypeScript and React')
    expect(result).toContain('TypeScript')
    expect(result).toContain('React')
  })

  it('matches "Next.js" without also matching bare "JS"', () => {
    const result = extractTechStack('Built with Next.js')
    expect(result).toContain('Next.js')
    expect(result).not.toContain('JavaScript')
  })

  it('matches "Go" as a standalone word', () => {
    const result = extractTechStack('We use Go for backend services')
    expect(result).toContain('Go')
  })

  it('does not match "Rust" inside "robust"', () => {
    const result = extractTechStack('robust systems and reliable code')
    expect(result).not.toContain('Rust')
  })

  it('is case-insensitive and preserves canonical casing', () => {
    const result = extractTechStack('experience with typescript and mongodb')
    expect(result).toContain('TypeScript')
    expect(result).toContain('MongoDB')
  })

  it('returns an empty array for empty input', () => {
    expect(extractTechStack('')).toEqual([])
  })

  it('extracts Node.js and PostgreSQL correctly', () => {
    const result = extractTechStack('Node.js and PostgreSQL required')
    expect(result).toContain('Node.js')
    expect(result).toContain('PostgreSQL')
  })
})

// ─── buildSearchUrl — seniority / work-type / recency filters ─────────────────

describe('buildSearchUrl — new structured filters', () => {
  it('sets f_E=4 for senior seniority', () => {
    const url = buildSearchUrl('engineer', { seniorities: ['senior'] }, 0)
    expect(url).toContain('f_E=4')
  })

  it('sets f_E=1 for intern seniority', () => {
    const url = buildSearchUrl('engineer', { seniorities: ['intern'] }, 0)
    expect(url).toContain('f_E=1')
  })

  it('sets f_E=2%2C4 (comma-joined) for multiple seniorities', () => {
    const url = buildSearchUrl('engineer', { seniorities: ['junior', 'senior'] }, 0)
    // URL-encoded comma → %2C, or plain comma depending on URLSearchParams behaviour
    const decoded = decodeURIComponent(url)
    expect(decoded).toContain('f_E=2,4')
  })

  it('omits f_E when seniorities array is empty', () => {
    const url = buildSearchUrl('engineer', { seniorities: [] }, 0)
    expect(url).not.toContain('f_E')
  })

  it('sets f_WT=3 for hybrid work type', () => {
    const url = buildSearchUrl('engineer', { workTypes: ['hybrid'] }, 0)
    expect(url).toContain('f_WT=3')
  })

  it('sets f_WT=1 for onsite work type', () => {
    const url = buildSearchUrl('engineer', { workTypes: ['onsite'] }, 0)
    expect(url).toContain('f_WT=1')
  })

  it('sets comma-joined f_WT for multiple work types', () => {
    const url = buildSearchUrl('engineer', { workTypes: ['remote', 'hybrid'] }, 0)
    const decoded = decodeURIComponent(url)
    expect(decoded).toContain('f_WT=2,3')
  })

  it('sets f_TPR=r86400 for recency=day', () => {
    const url = buildSearchUrl('engineer', { recency: 'day' }, 0)
    expect(url).toContain('f_TPR=r86400')
  })

  it('sets f_TPR=r604800 for recency=week', () => {
    const url = buildSearchUrl('engineer', { recency: 'week' }, 0)
    expect(url).toContain('f_TPR=r604800')
  })

  it('sets f_TPR=r2592000 for recency=month', () => {
    const url = buildSearchUrl('engineer', { recency: 'month' }, 0)
    expect(url).toContain('f_TPR=r2592000')
  })

  it('omits f_TPR when recency is absent', () => {
    const url = buildSearchUrl('engineer', {}, 0)
    expect(url).not.toContain('f_TPR')
  })

  it('combines all filters in a single URL', () => {
    const url = buildSearchUrl('engineer', {
      location: 'San Francisco',
      seniorities: ['senior'],
      workTypes: ['remote'],
      recency: 'week',
    }, 25)
    expect(url).toContain('location=San+Francisco')
    expect(url).toContain('f_E=4')
    expect(url).toContain('f_WT=2')
    expect(url).toContain('f_TPR=r604800')
    expect(url).toContain('start=25')
  })
})
