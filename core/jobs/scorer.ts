import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import Database from 'better-sqlite3'
import type { JobPosting } from './adapters/base'
import { writeLLMUsage } from './llmUsage'
import { serializeProfile } from '../resume/agent'
import { getAllEntries, getUserProfile } from '../profile/repository'
import { computeYoeFromEntries, computePerTechYoe } from '../profile/yoe'
import type { ProfileEntry } from '../profile/models'
import { withQuotaGuard, type QuotaErrorCallback } from '../llm/withQuotaGuard'
import {
  HardRequirementsSchema,
  evaluateHardRequirements,
  type HardRequirements,
  type CandidateQualifications,
  type HardReqsTier,
} from './hardReqs'

const MODEL = 'claude-haiku-4-5'

// ─── Nice-to-haves scoring ────────────────────────────────────────────────────
//
// Hard requirements are evaluated deterministically by core/jobs/hardReqs.ts.
// Nice-to-haves remain an LLM judgment because they're inherently fuzzy; they
// contribute a small weight to the composite affinity score but never drive
// the qualification tier.

const NICE_SCORE: Record<string, number> = {
  fully_met:     1.0,
  partially_met: 0.5,
  not_met:       0.0,
}

function computeAffinityScore(hardScore: number, niceClass: string): number {
  const n = NICE_SCORE[niceClass] ?? 0.5
  return 0.75 * hardScore + 0.25 * n
}

// ─── LLM output schema ────────────────────────────────────────────────────────

const ScoringResultSchema = z.object({
  posting_id: z.string(),
  seniority: z.enum(['intern', 'junior', 'mid', 'senior', 'staff', 'any']),
  tech_stack: z.array(z.string()),
  salary_min: z.number().nullable(),
  salary_max: z.number().nullable(),
  hard_requirements: HardRequirementsSchema,
  nice_to_haves: z.array(z.string()),
  nice_to_haves_class: z.enum(['fully_met', 'partially_met', 'not_met']),
  description_snippet: z.string(),
})

type ScoringResult = z.infer<typeof ScoringResultSchema>

const MAX_SNIPPET_CHARS = 500

// ─── Candidate qualifications block ──────────────────────────────────────────

function buildCandidateBlock(cand: CandidateQualifications): string {
  const lines: string[] = []
  lines.push(`- Total professional experience: ${cand.yoe.toFixed(1)} years`)
  const techs = Object.entries(cand.per_tech_yoe)
    .filter(([, y]) => y >= 0.25)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
  if (techs.length) {
    lines.push(
      `- Per-tech experience: ${techs.map(([t, y]) => `${t} (${y.toFixed(1)}y)`).join(', ')}`,
    )
  }
  if (cand.yoe_industry.length) lines.push(`- Industries: ${cand.yoe_industry.join(', ')}`)
  if (cand.citizenship.length) {
    lines.push(
      `- Citizenship / visa: ${cand.citizenship.map((c) => `${c.country} (${c.status})`).join('; ')}`,
    )
  }
  if (cand.languages.length) {
    lines.push(
      `- Languages: ${cand.languages.map((l) => `${l.name} (${l.proficiency})`).join(', ')}`,
    )
  }
  if (cand.enrollment_status) lines.push(`- Enrollment status: ${cand.enrollment_status}`)
  if (cand.drivers_license) lines.push(`- Driver's licence: yes`)
  return lines.join('\n')
}

function loadCandidate(db: Database.Database, entries: ProfileEntry[]): CandidateQualifications {
  const profile = getUserProfile(db)
  return {
    yoe: computeYoeFromEntries(entries),
    per_tech_yoe: computePerTechYoe(entries),
    yoe_industry: profile.yoe_industry,
    languages: profile.languages,
    citizenship: profile.citizenship,
    drivers_license: profile.drivers_license,
    enrollment_status: null, // not yet tracked in user profile; reserved for future
  }
}

// ─── Prompt ──────────────────────────────────────────────────────────────────

function buildScoringPrompt(
  postingId: string,
  title: string,
  company: string,
  jobDescription: string,
  serializedProfile: string,
  intent: string,
  candidateBlock: string,
): string {
  return `You are a job-posting parser. Extract structured data from this posting. The candidate is provided only for context (so you know what nice-to-haves to look for); the qualification gating is done in code, not by you.

## Search Intent
${intent}

## Candidate Qualifications (for context only)
${candidateBlock}

## Candidate Profile (free-form)
${serializedProfile.slice(0, 4000)}

## Job Posting
posting_id: ${postingId}
title: ${title}
company: ${company}
description:
${jobDescription.slice(0, 3500)}

## Task
Return ONLY a valid JSON object — no markdown, no commentary:

{
  "posting_id": "${postingId}",
  "seniority": "<intern|junior|mid|senior|staff|any — your best judgement; use 'any' only when the posting truly does not signal a level. Prefer guessing from years-of-experience (0–1 = intern, 1–3 = junior, 3–6 = mid, 6–10 = senior, 10+ = staff) and title cues (e.g. Engineer I = junior, II = mid, III/IV = senior, V+ = staff). Do NOT default to 'any' just because no explicit keyword is present.>",
  "tech_stack": [<lowercase technologies mentioned in the posting>],
  "salary_min": <annual USD integer or null>,
  "salary_max": <annual USD integer or null>,
  "hard_requirements": {
    "yoe_min": <minimum total years required as integer, or null if not stated>,
    "yoe_max": <maximum years stated (rare), or null>,
    "tech_stack_required": [<lowercase techs the posting REQUIRES (not "nice to have")>],
    "tech_stack_yoe": [
      { "tech": "<lowercase>", "yoe_min": <integer or null> }
      // include only when posting says "N+ years of X" for a specific tech
    ],
    "languages_required": [
      { "name": "<language>", "min_proficiency": "<beginner|elementary|intermediate|conversational|professional|fluent|native|null>" }
    ],
    "citizenship_required": [
      { "country": "<country>", "allowed_statuses": [<e.g. "citizen", "permanent_resident", "work_permit">] }
      // only when the posting explicitly restricts by citizenship/work authorization
    ],
    "enrollment_status": <"enrolled"|"graduated"|null>,
    "drivers_license_required": <true|false>,
    "other": [<short strings describing hard reqs you couldn't fit above, e.g. "security clearance: Secret">]
  },
  "nice_to_haves": [<short strings describing each preferred-but-not-required item>],
  "nice_to_haves_class": "<fully_met|partially_met|not_met — judge against the Candidate Qualifications above>",
  "description_snippet": "<see rules below>"
}

## Extraction rules
- "hard_requirements" describes the JOB'S REQUIREMENTS, not the candidate. Do NOT decide whether the candidate is qualified — code will do that.
- Treat a requirement as "hard" only if the posting clearly marks it required (mandatory, required, must have, minimum). When in doubt, put it in "nice_to_haves" instead.
- tech_stack_required: lowercase, deduplicated. Use canonical names (e.g. "javascript" not "JS"; "node.js" not "node").
- citizenship_required: include only when the posting *explicitly* restricts by citizenship or work authorization — not when it merely says "must be authorized to work" generically (that's universal). Use country names (e.g. "United States", "Canada") and statuses like "citizen", "permanent_resident", "work_permit".
- languages_required: spoken languages required to do the job, not programming languages.
- enrollment_status: "enrolled" if posting is for current students/interns; "graduated" if it requires a completed degree; null otherwise.

## description_snippet rules (strict)
- Quote VERBATIM from the job description above. Do not paraphrase, summarize, translate, or reword in any way.
- Pick the contiguous span that best answers "what is this role?" — typically the opening 1–3 sentences along the lines of "X is hiring a Y to do Z" or "We're looking for a Y to ...".
- If no clean intro exists, take the first 1–3 sentences of the description verbatim.
- Hard limit: ≤ 400 characters. If the natural span is longer, truncate at a sentence or word boundary and end with "…".
- Strip HTML tags, bullet markers, and surrounding whitespace, but otherwise preserve the original wording exactly.
- Never invent text that is not present in the description.`
}

// ─── Concurrency limiter ──────────────────────────────────────────────────────

export function makeSemaphore(concurrency: number) {
  let running = 0
  const queue: Array<() => void> = []

  function next(): void {
    if (queue.length > 0 && running < concurrency) {
      running++
      queue.shift()!()
    }
  }

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(async () => {
        try {
          resolve(await fn())
        } catch (e) {
          reject(e)
        } finally {
          running--
          next()
        }
      })
      next()
    })
  }
}

// ─── Persistence helpers ──────────────────────────────────────────────────────

interface PersistInput {
  posting_id: string
  scored_at: string | null
  result: ScoringResult | null
  hardReqs: HardRequirements | null
  hardScore: number | null
  tier: HardReqsTier | null
  reasoning: string | null
  description_snippet: string | null
}

function makeUpdatePostingStmt(db: Database.Database) {
  return db.prepare(
    `UPDATE job_postings
     SET affinity_score      = @score,
         affinity_scored_at  = @scored_at,
         affinity_skipped    = 0,
         affinity_reasoning  = @reasoning,
         description_snippet = @description_snippet,
         hard_reqs_class     = @hard_reqs_class,
         nice_to_haves_class = @nice_to_haves_class,
         hard_reqs_struct    = @hard_reqs_struct,
         yoe_min             = @yoe_min,
         yoe_max             = @yoe_max,
         seniority           = @seniority,
         tech_stack          = @tech_stack,
         salary_min          = @salary_min,
         salary_max          = @salary_max
     WHERE id = @id`,
  )
}

function buildReasoning(
  hardScore: number,
  failures: string[],
  exceeds: string[],
  niceClass: string,
): string {
  if (failures.length > 0) return failures.slice(0, 3).join(' ')
  if (exceeds.length > 0) return exceeds[0]
  if (niceClass === 'fully_met') return 'Meets all hard requirements; nice-to-haves fully met.'
  if (niceClass === 'partially_met') return 'Meets all hard requirements; some nice-to-haves met.'
  return 'Meets all hard requirements.'
}

function clampSnippet(s: string | null | undefined): string | null {
  if (!s) return null
  const trimmed = s.trim()
  if (!trimmed) return null
  if (trimmed.length <= MAX_SNIPPET_CHARS) return trimmed
  return trimmed.slice(0, MAX_SNIPPET_CHARS - 1) + '…'
}

// ─── Single-posting scoring ───────────────────────────────────────────────────

interface ScoringContext {
  intent: string
  serializedProfile: string
  candidate: CandidateQualifications
  candidateBlock: string
  client: Anthropic
}

function buildContext(db: Database.Database, apiKey: string): ScoringContext {
  const intent =
    (db.prepare('SELECT intent FROM search_config WHERE id = 1').get() as { intent: string | null })
      ?.intent ?? ''
  const entries = getAllEntries(db)
  const serializedProfile = serializeProfile(entries)
  const candidate = loadCandidate(db, entries)
  return {
    intent,
    serializedProfile,
    candidate,
    candidateBlock: buildCandidateBlock(candidate),
    client: new Anthropic({ apiKey }),
  }
}

async function runScoringCall(
  ctx: ScoringContext,
  posting: JobPosting,
  maxTokens: number,
  onQuotaError: QuotaErrorCallback | undefined,
  db: Database.Database,
): Promise<ScoringResult> {
  const jd = posting.raw_text ?? `${posting.title} at ${posting.company}`
  const response = await withQuotaGuard(
    () => ctx.client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [
        {
          role: 'user',
          content: buildScoringPrompt(
            posting.id,
            posting.title,
            posting.company,
            jd,
            ctx.serializedProfile,
            ctx.intent,
            ctx.candidateBlock,
          ),
        },
      ],
    }),
    onQuotaError,
  )
  writeLLMUsage(db, {
    call_type: 'affinity_scoring',
    model: MODEL,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    posting_id: posting.id,
  })
  const raw = response.content.find((b) => b.type === 'text')?.text ?? ''
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  const validated = ScoringResultSchema.safeParse(JSON.parse(cleaned))
  if (!validated.success) throw new Error('schema mismatch')
  return validated.data
}

function applyResult(
  db: Database.Database,
  posting: JobPosting,
  ctx: ScoringContext,
  result: ScoringResult,
  now: string,
): JobPosting {
  const evaluation = evaluateHardRequirements(result.hard_requirements, ctx.candidate)
  const affinity = computeAffinityScore(evaluation.score, result.nice_to_haves_class)
  const description_snippet = clampSnippet(result.description_snippet)
  const reasoning = buildReasoning(
    evaluation.score,
    evaluation.failures,
    evaluation.exceeds,
    result.nice_to_haves_class,
  )

  makeUpdatePostingStmt(db).run({
    score: affinity,
    scored_at: now,
    id: posting.id,
    reasoning,
    description_snippet,
    hard_reqs_class: evaluation.tier,
    nice_to_haves_class: result.nice_to_haves_class,
    hard_reqs_struct: JSON.stringify(result.hard_requirements),
    yoe_min: result.hard_requirements.yoe_min,
    yoe_max: result.hard_requirements.yoe_max,
    seniority: result.seniority,
    tech_stack: JSON.stringify(result.tech_stack),
    salary_min: result.salary_min,
    salary_max: result.salary_max,
  })

  // Honour the search term's seniority restriction now that we have the LLM's
  // (more reliable) classification. Archive any posting whose final seniority
  // is outside the requested set — only when we have a confident seniority.
  if (
    posting.required_seniorities &&
    posting.required_seniorities.length > 0 &&
    result.seniority !== 'any' &&
    !posting.required_seniorities.includes(result.seniority)
  ) {
    db.prepare('UPDATE job_postings SET archived_at = ? WHERE id = ?')
      .run(now, posting.id)
  }

  return {
    ...posting,
    yoe_min: result.hard_requirements.yoe_min,
    yoe_max: result.hard_requirements.yoe_max,
    seniority: result.seniority,
    tech_stack: result.tech_stack,
    salary_min: result.salary_min,
    salary_max: result.salary_max,
    affinity_score: affinity,
    affinity_scored_at: now,
    affinity_skipped: false,
    affinity_reasoning: reasoning,
    description_snippet,
    hard_reqs_class: evaluation.tier,
    nice_to_haves_class: result.nice_to_haves_class,
  }
}

function persistFailure(db: Database.Database, posting: JobPosting): void {
  makeUpdatePostingStmt(db).run({
    score: null,
    scored_at: null,
    id: posting.id,
    reasoning: null,
    description_snippet: null,
    hard_reqs_class: null,
    nice_to_haves_class: null,
    hard_reqs_struct: null,
    yoe_min: posting.yoe_min ?? null,
    yoe_max: posting.yoe_max ?? null,
    seniority: posting.seniority,
    tech_stack: JSON.stringify(posting.tech_stack),
    salary_min: posting.salary_min ?? null,
    salary_max: posting.salary_max ?? null,
  })
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function scorePostings(
  db: Database.Database,
  apiKey: string,
  candidates: JobPosting[],
  onQuotaError?: QuotaErrorCallback,
): Promise<void> {
  if (candidates.length === 0) return
  const ctx = buildContext(db, apiKey)
  const now = new Date().toISOString()
  const limit = makeSemaphore(10)

  async function scoreOne(posting: JobPosting): Promise<void> {
    try {
      const result = await runScoringCall(ctx, posting, 1024, onQuotaError, db)
      applyResult(db, posting, ctx, result, now)
    } catch {
      persistFailure(db, posting)
    }
  }

  await Promise.all(candidates.map((p) => limit(() => scoreOne(p))))
}

export async function scorePosting(
  db: Database.Database,
  apiKey: string,
  posting: JobPosting,
  onQuotaError?: QuotaErrorCallback,
): Promise<JobPosting> {
  const ctx = buildContext(db, apiKey)
  const now = new Date().toISOString()
  try {
    const result = await runScoringCall(ctx, posting, 1024, onQuotaError, db)
    return applyResult(db, posting, ctx, result, now)
  } catch {
    return posting
  }
}
