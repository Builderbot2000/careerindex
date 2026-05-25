import type { ProfileEntry } from './models'

interface Interval {
  start: number
  end: number
}

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000

function parseDate(s: string | null, fallback: number): number | null {
  if (!s) return fallback
  const t = Date.parse(s)
  if (Number.isNaN(t)) return null
  return t
}

function unionIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return []
  const sorted = [...intervals].sort((a, b) => a.start - b.start)
  const merged: Interval[] = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1]
    const cur = sorted[i]
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end)
    } else {
      merged.push(cur)
    }
  }
  return merged
}

function entryIntervals(entries: ProfileEntry[]): Interval[] {
  const now = Date.now()
  const out: Interval[] = []
  for (const e of entries) {
    if (e.type !== 'experience') continue
    const start = parseDate(e.start_date, NaN as unknown as number)
    if (start === null || Number.isNaN(start)) continue
    const end = parseDate(e.end_date, now)
    if (end === null) continue
    if (end <= start) continue
    out.push({ start, end })
  }
  return out
}

/**
 * Total years of professional experience computed from experience entries.
 * Overlapping date ranges are unioned so concurrent jobs don't double-count.
 * Returns 0 if no experience entries have parseable date ranges.
 */
export function computeYoeFromEntries(entries: ProfileEntry[]): number {
  const intervals = entryIntervals(entries)
  const merged = unionIntervals(intervals)
  const totalMs = merged.reduce((sum, i) => sum + (i.end - i.start), 0)
  return totalMs / MS_PER_YEAR
}

/**
 * Per-technology YOE computed from tags on experience entries.
 * Each tag inherits the full duration of its parent entry. Overlapping
 * intervals tagged with the same tech are unioned. Tag keys are lowercased.
 */
export function computePerTechYoe(entries: ProfileEntry[]): Record<string, number> {
  const buckets: Record<string, Interval[]> = {}
  const now = Date.now()
  for (const e of entries) {
    if (e.type !== 'experience') continue
    const start = parseDate(e.start_date, NaN as unknown as number)
    if (start === null || Number.isNaN(start)) continue
    const end = parseDate(e.end_date, now)
    if (end === null || end <= start) continue
    for (const tag of e.tags) {
      const key = tag.trim().toLowerCase()
      if (!key) continue
      ;(buckets[key] ??= []).push({ start, end })
    }
  }
  const out: Record<string, number> = {}
  for (const [tech, intervals] of Object.entries(buckets)) {
    const merged = unionIntervals(intervals)
    const totalMs = merged.reduce((sum, i) => sum + (i.end - i.start), 0)
    out[tech] = totalMs / MS_PER_YEAR
  }
  return out
}
