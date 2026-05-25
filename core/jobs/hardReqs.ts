import { z } from 'zod'
import type { LanguageItem, CitizenshipItem } from '../profile/models'

// ─── Structured hard requirements emitted by the scoring LLM ─────────────────

export const TechYoeReqSchema = z.object({
  tech: z.string(),
  yoe_min: z.number().nullable(),
})
export type TechYoeReq = z.infer<typeof TechYoeReqSchema>

export const LanguageReqSchema = z.object({
  name: z.string(),
  min_proficiency: z.string().nullable(),
})
export type LanguageReq = z.infer<typeof LanguageReqSchema>

export const CitizenshipReqSchema = z.object({
  country: z.string(),
  allowed_statuses: z.array(z.string()),
})
export type CitizenshipReq = z.infer<typeof CitizenshipReqSchema>

export const HardRequirementsSchema = z.object({
  yoe_min: z.number().nullable(),
  yoe_max: z.number().nullable(),
  tech_stack_required: z.array(z.string()),
  tech_stack_yoe: z.array(TechYoeReqSchema),
  languages_required: z.array(LanguageReqSchema),
  citizenship_required: z.array(CitizenshipReqSchema),
  enrollment_status: z.enum(['enrolled', 'graduated']).nullable(),
  drivers_license_required: z.boolean(),
  other: z.array(z.string()),
})
export type HardRequirements = z.infer<typeof HardRequirementsSchema>

// ─── Candidate facts used by the deterministic evaluator ─────────────────────

export interface CandidateQualifications {
  yoe: number
  per_tech_yoe: Record<string, number>
  yoe_industry: string[]
  languages: LanguageItem[]
  citizenship: CitizenshipItem[]
  drivers_license: boolean
  enrollment_status: 'enrolled' | 'graduated' | null
}

// ─── Evaluator ────────────────────────────────────────────────────────────────

export type HardReqsTier =
  | 'overqualified'
  | 'fully_qualified'
  | 'minimally_qualified'
  | 'underqualified'

export interface HardReqsEvaluation {
  score: number          // 0..1, deterministic
  tier: HardReqsTier
  failures: string[]     // human-readable list of gaps
  exceeds: string[]      // human-readable list of areas where the candidate exceeds the bar
}

// Language proficiency ordering, lowest → highest. Anything outside this list
// is treated as the highest tier so an unknown proficiency never blocks.
const PROFICIENCY_RANK: Record<string, number> = {
  beginner: 0,
  elementary: 1,
  intermediate: 2,
  conversational: 3,
  professional: 4,
  fluent: 5,
  native: 6,
}

function proficiencyMeets(have: string, need: string): boolean {
  const h = PROFICIENCY_RANK[have.toLowerCase()] ?? 99
  const n = PROFICIENCY_RANK[need.toLowerCase()] ?? 0
  return h >= n
}

function statusMeets(haveStatus: string, allowed: string[]): boolean {
  const h = haveStatus.toLowerCase()
  return allowed.some((s) => s.toLowerCase() === h)
}

function lowerSet(arr: string[]): Set<string> {
  return new Set(arr.map((s) => s.toLowerCase()))
}

export function evaluateHardRequirements(
  reqs: HardRequirements,
  cand: CandidateQualifications,
): HardReqsEvaluation {
  const failures: string[] = []
  const exceeds: string[] = []

  // ─ YOE gate ────────────────────────────────────────────────────────────────
  if (reqs.yoe_min !== null) {
    if (cand.yoe < reqs.yoe_min) {
      failures.push(
        `Needs ${reqs.yoe_min}+ years of experience; you have ${cand.yoe.toFixed(1)}.`,
      )
    } else if (reqs.yoe_max !== null && cand.yoe > reqs.yoe_max + 2) {
      exceeds.push(
        `Role tops out at ~${reqs.yoe_max} YOE; you have ${cand.yoe.toFixed(1)}.`,
      )
    } else if (reqs.yoe_max === null && cand.yoe >= reqs.yoe_min * 2) {
      exceeds.push(
        `Needs ${reqs.yoe_min}+ YOE; you have ${cand.yoe.toFixed(1)} — well above floor.`,
      )
    }
  }

  // ─ Tech stack presence ─────────────────────────────────────────────────────
  if (reqs.tech_stack_required.length > 0) {
    const candTechs = lowerSet(Object.keys(cand.per_tech_yoe))
    for (const tech of reqs.tech_stack_required) {
      if (!candTechs.has(tech.toLowerCase())) {
        failures.push(`Missing required tech: ${tech}.`)
      }
    }
  }

  // ─ Per-tech YOE ────────────────────────────────────────────────────────────
  for (const t of reqs.tech_stack_yoe) {
    if (t.yoe_min === null) continue
    const have = cand.per_tech_yoe[t.tech.toLowerCase()] ?? 0
    if (have < t.yoe_min) {
      failures.push(
        `Needs ${t.yoe_min}+ years of ${t.tech}; you have ${have.toFixed(1)}.`,
      )
    }
  }

  // ─ Languages ───────────────────────────────────────────────────────────────
  for (const lreq of reqs.languages_required) {
    const have = cand.languages.find(
      (l) => l.name.toLowerCase() === lreq.name.toLowerCase(),
    )
    if (!have) {
      failures.push(`Needs ${lreq.name}.`)
      continue
    }
    if (lreq.min_proficiency && !proficiencyMeets(have.proficiency, lreq.min_proficiency)) {
      failures.push(
        `Needs ${lreq.name} at ${lreq.min_proficiency}+; you have ${have.proficiency}.`,
      )
    }
  }

  // ─ Citizenship / work authorization ────────────────────────────────────────
  for (const creq of reqs.citizenship_required) {
    const have = cand.citizenship.find(
      (c) => c.country.toLowerCase() === creq.country.toLowerCase(),
    )
    if (!have) {
      failures.push(
        `Needs ${creq.country} work authorization (${creq.allowed_statuses.join('/')}).`,
      )
      continue
    }
    if (creq.allowed_statuses.length > 0 && !statusMeets(have.status, creq.allowed_statuses)) {
      failures.push(
        `Needs ${creq.country} status in [${creq.allowed_statuses.join(', ')}]; you have ${have.status}.`,
      )
    }
  }

  // ─ Enrollment status ───────────────────────────────────────────────────────
  if (reqs.enrollment_status !== null) {
    if (cand.enrollment_status === null) {
      failures.push(`Needs ${reqs.enrollment_status} status.`)
    } else if (cand.enrollment_status !== reqs.enrollment_status) {
      failures.push(
        `Needs ${reqs.enrollment_status} status; you are ${cand.enrollment_status}.`,
      )
    }
  }

  // ─ Driver's licence ────────────────────────────────────────────────────────
  if (reqs.drivers_license_required && !cand.drivers_license) {
    failures.push(`Needs driver's licence.`)
  }

  // ─ Score & tier ────────────────────────────────────────────────────────────
  let score: number
  let tier: HardReqsTier
  if (failures.length === 0) {
    if (exceeds.length > 0) {
      score = 0.7
      tier = 'overqualified'
    } else {
      score = 1.0
      tier = 'fully_qualified'
    }
  } else if (failures.length === 1) {
    // Single soft miss (anything except YOE) → still acceptable
    const onlyMiss = failures[0]
    const isYoeMiss = onlyMiss.startsWith('Needs ') && onlyMiss.includes('years of experience;')
    if (isYoeMiss) {
      score = 0.05
      tier = 'underqualified'
    } else {
      score = 0.45
      tier = 'minimally_qualified'
    }
  } else {
    score = 0.05
    tier = 'underqualified'
  }

  return { score, tier, failures, exceeds }
}
