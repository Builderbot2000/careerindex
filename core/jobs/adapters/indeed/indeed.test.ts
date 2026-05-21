import { describe, it, expect } from 'vitest'
import { buildSearchUrl, cleanJobUrl, parsePostedAt } from './index'

// ─── cleanJobUrl ──────────────────────────────────────────────────────────────

describe('cleanJobUrl', () => {
  it('produces a canonical viewjob URL from a job key', () => {
    expect(cleanJobUrl('abc123')).toBe('https://www.indeed.com/viewjob?jk=abc123')
  })
})

// ─── buildSearchUrl ───────────────────────────────────────────────────────────

describe('buildSearchUrl', () => {
  it('includes q param for the search term', () => {
    const url = buildSearchUrl('typescript engineer', {}, 0)
    expect(url).toContain('q=typescript+engineer')
  })

  it('includes l param when location is provided', () => {
    const url = buildSearchUrl('engineer', { location: 'San Francisco' }, 0)
    expect(url).toContain('l=San+Francisco')
  })

  it('includes fromage=1 for day recency', () => {
    const url = buildSearchUrl('engineer', { recency: 'day' }, 0)
    expect(url).toContain('fromage=1')
  })

  it('includes fromage=7 for week recency', () => {
    const url = buildSearchUrl('engineer', { recency: 'week' }, 0)
    expect(url).toContain('fromage=7')
  })

  it('includes fromage=30 for month recency', () => {
    const url = buildSearchUrl('engineer', { recency: 'month' }, 0)
    expect(url).toContain('fromage=30')
  })

  it('includes remotejob=1 when remote is in workTypes', () => {
    const url = buildSearchUrl('engineer', { workTypes: ['remote'] }, 0)
    expect(url).toContain('remotejob=1')
  })

  it('does not include remotejob when workTypes does not include remote', () => {
    const url = buildSearchUrl('engineer', { workTypes: ['onsite', 'hybrid'] }, 0)
    expect(url).not.toContain('remotejob')
  })

  it('reflects start offset for pagination', () => {
    const url = buildSearchUrl('engineer', {}, 20)
    expect(url).toContain('start=20')
  })

  it('omits fromage when recency is not set', () => {
    const url = buildSearchUrl('engineer', {}, 0)
    expect(url).not.toContain('fromage')
  })

  it('includes all params when all filters are provided', () => {
    const url = buildSearchUrl('engineer', { location: 'NYC', recency: 'week', workTypes: ['remote'] }, 10)
    expect(url).toContain('q=engineer')
    expect(url).toContain('l=NYC')
    expect(url).toContain('fromage=7')
    expect(url).toContain('remotejob=1')
    expect(url).toContain('start=10')
  })

  it('routes country locations to the country-specific subdomain and drops the l param', () => {
    const url = buildSearchUrl('engineer', { location: 'Canada' }, 0)
    expect(url).toMatch(/^https:\/\/ca\.indeed\.com\/jobs\?/)
    expect(url).not.toContain('l=')
  })

  it('is case-insensitive when matching country names', () => {
    expect(buildSearchUrl('e', { location: 'canada' }, 0)).toContain('ca.indeed.com')
    expect(buildSearchUrl('e', { location: 'CANADA' }, 0)).toContain('ca.indeed.com')
  })

  it('recognizes UK aliases', () => {
    expect(buildSearchUrl('e', { location: 'UK' }, 0)).toContain('uk.indeed.com')
    expect(buildSearchUrl('e', { location: 'United Kingdom' }, 0)).toContain('uk.indeed.com')
  })

  it('keeps city locations on the default US host with the l param', () => {
    const url = buildSearchUrl('engineer', { location: 'Toronto, ON' }, 0)
    expect(url).toMatch(/^https:\/\/www\.indeed\.com\/jobs\?/)
    expect(url).toContain('l=Toronto%2C+ON')
  })
})

// ─── parsePostedAt ────────────────────────────────────────────────────────────

describe('parsePostedAt', () => {
  const today = new Date().toISOString().slice(0, 10)

  it('returns today for "Just posted"', () => {
    expect(parsePostedAt('Just posted')).toBe(today)
  })

  it('returns today for "Today"', () => {
    expect(parsePostedAt('Today')).toBe(today)
  })

  it('returns today for "today" (lowercase)', () => {
    expect(parsePostedAt('today')).toBe(today)
  })

  it('returns N days ago for "1 day ago"', () => {
    const expected = new Date()
    expected.setDate(expected.getDate() - 1)
    expect(parsePostedAt('1 day ago')).toBe(expected.toISOString().slice(0, 10))
  })

  it('returns N days ago for "5 days ago"', () => {
    const expected = new Date()
    expected.setDate(expected.getDate() - 5)
    expect(parsePostedAt('5 days ago')).toBe(expected.toISOString().slice(0, 10))
  })

  it('returns N weeks ago for "2 weeks ago"', () => {
    const expected = new Date()
    expected.setDate(expected.getDate() - 14)
    expect(parsePostedAt('2 weeks ago')).toBe(expected.toISOString().slice(0, 10))
  })

  it('returns null for "30+ days ago"', () => {
    expect(parsePostedAt('30+ days ago')).toBeNull()
  })

  it('returns null for unrecognised text', () => {
    expect(parsePostedAt('Actively recruiting')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parsePostedAt('')).toBeNull()
  })
})
