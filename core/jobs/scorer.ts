import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import Database from 'better-sqlite3'
import type { JobPosting } from './adapters/base'
import { writeLLMUsage } from './llmUsage'
import { serializeProfile } from '../resume/agent'
import { getAllEntries, getUserProfile } from '../profile/repository'
import type { LanguageItem, CitizenshipItem } from '../profile/models'
import { withQuotaGuard, type QuotaErrorCallback } from '../llm/withQuotaGuard'

const MODEL = 'claude-haiku-4-5'

// ─── Scoring formula ──────────────────────────────────────────────────────────

const HARD_SCORE: Record<string, number> = {
  overqualified:       0.70,
  fully_qualified:     1.00,
  minimally_qualified: 0.45,
  underqualified:      0.05,
}

const NICE_SCORE: Record<string, number> = {
  fully_met:    1.0,
  partially_met: 0.5,
  not_met:      0.0,
}

function computeAffinityScore(hardClass: string, niceClass: string): number {
  const h = HARD_SCORE[hardClass] ?? 0.5
  const n = NICE_SCORE[niceClass] ?? 0.5
  return 0.75 * h + 0.25 * n
}

// ─── LLM output schema ────────────────────────────────────────────────────────

const AffinityResultSchema = z.object({
  posting_id: z.string(),
  yoe_min: z.number().nullable(),
  yoe_max: z.number().nullable(),
  seniority: z.enum(['intern', 'junior', 'mid', 'senior', 'staff', 'any']),
  tech_stack: z.array(z.string()),
  salary_min: z.number().nullable(),
  salary_max: z.number().nullable(),
  hard_reqs_class: z.enum([
    'overqualified',
    'fully_qualified',
    'minimally_qualified',
    'underqualified',
  ]),
  nice_to_haves_class: z.enum(['fully_met', 'partially_met', 'not_met']),
  reasoning: z.string(),
  description_snippet: z.string(),
})

const MAX_SNIPPET_CHARS = 500

type AffinityResult = z.infer<typeof AffinityResultSchema>

// ─── Prompt builder ───────────────────────────────────────────────────────────

interface CandidateFacts {
  yoe: number | null
  yoe_industry: string[]
  languages: LanguageItem[]
  citizenship: CitizenshipItem[]
  drivers_license: boolean
}

function buildCandidateFactsBlock(facts: CandidateFacts): string {
  const lines: string[] = []
  if (facts.yoe !== null) {
    const industry = facts.yoe_industry.length ? ` (industries: ${facts.yoe_industry.join(', ')})` : ''
    lines.push(`- Total professional experience: ${facts.yoe} years${industry}`)
  }
  if (facts.citizenship.length) lines.push(`- Citizenship / visa: ${facts.citizenship.map((c) => `${c.country} (${c.status})`).join('; ')}`)
  if (facts.languages.length) lines.push(`- Languages: ${facts.languages.map((l) => `${l.name} (${l.proficiency})`).join(', ')}`)
  if (facts.drivers_license) lines.push(`- Driver's licence: Yes`)
  return lines.length
    ? `## Candidate Facts (Authoritative)\nThese are ground-truth facts — they override any inferences from the profile text below.\n${lines.join('\n')}`
    : ''
}

function buildScoringPrompt(
  postingId: string,
  title: string,
  company: string,
  jobDescription: string,
  serializedProfile: string,
  intent: string,
  candidateFacts: CandidateFacts,
): string {
  const factsBlock = buildCandidateFactsBlock(candidateFacts)
  return `You are a job-fit evaluator. Analyse whether the candidate meets this job's requirements.

## Search Intent
${intent}
${factsBlock ? `\n${factsBlock}\n` : ''}
## Candidate Profile
${serializedProfile.slice(0, 6000)}

## Job Posting
posting_id: ${postingId}
title: ${title}
company: ${company}
description:
${jobDescription.slice(0, 3000)}

## Task
1. Parse the job posting to extract structured fields.
2. Extract the job's HARD REQUIREMENTS (must-haves: mandatory qualifications, skills, YOE).
3. Extract NICE-TO-HAVES (preferred but not required).
4. Evaluate the candidate against each group.
5. Return ONLY a valid JSON object — no markdown, no commentary:

{
  "posting_id": "${postingId}",
  "yoe_min": <minimum years of experience required as integer, or null if not stated>,
  "yoe_max": <maximum years of experience as integer, or null if not stated>,
  "seniority": "<intern|junior|mid|senior|staff|any — inferred from the posting, not the candidate>",
  "tech_stack": [<lowercase array of technologies explicitly required or mentioned in the posting>],
  "salary_min": <minimum annual salary in USD as integer, or null if not stated>,
  "salary_max": <maximum annual salary in USD as integer, or null if not stated>,
  "hard_reqs_class": "<overqualified|fully_qualified|minimally_qualified|underqualified>",
  "nice_to_haves_class": "<fully_met|partially_met|not_met>",
  "reasoning": "<one sentence: key fit or gap>",
  "description_snippet": "<see below>"
}

## description_snippet rules (strict)
- Quote VERBATIM from the job description above. Do not paraphrase, summarize, translate, or reword in any way.
- Pick the contiguous span that best answers "what is this role?" — typically the opening 1–3 sentences along the lines of "X is hiring a Y to do Z" or "We're looking for a Y to ...".
- If no clean intro exists, take the first 1–3 sentences of the description verbatim.
- Hard limit: ≤ 400 characters. If the natural span is longer, truncate at a sentence or word boundary and end with "…".
- Strip HTML tags, bullet markers, and surrounding whitespace, but otherwise preserve the original wording exactly.
- Never invent text that is not present in the description.

## Classification Guide

hard_reqs_class — treat hard requirements as gates, not sliding scales:
- overqualified: candidate clearly exceeds ALL hard requirements (e.g. 10 YOE for a 2–3 YOE role)
- fully_qualified: candidate meets ALL hard requirements
- minimally_qualified: candidate meets all hard requirements except exactly one minor non-YOE gap (e.g. missing one peripheral skill that is listed as required but not central to the role)
- underqualified: candidate fails ANY of the following — YOE below yoe_min (use Candidate Facts YOE, not inferred from profile dates), missing a core required skill, missing a mandatory qualification (citizenship, language, licence)

IMPORTANT: If the Candidate Facts section states a YOE and the job requires more, classify as underqualified regardless of how the profile text reads. Never estimate YOE from experience entry dates when an authoritative value is provided.

nice_to_haves_class:
- fully_met: candidate meets all or nearly all nice-to-haves
- partially_met: candidate meets some nice-to-haves
- not_met: candidate meets none of the nice-to-haves`
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

// ─── Main export ──────────────────────────────────────────────────────────────

export async function scorePostings(
  db: Database.Database,
  apiKey: string,
  candidates: JobPosting[],
  onQuotaError?: QuotaErrorCallback,
): Promise<void> {
  if (candidates.length === 0) return

  const intent =
    (db.prepare('SELECT intent FROM search_config WHERE id = 1').get() as { intent: string | null })
      ?.intent ?? ''

  const profileEntries = getAllEntries(db)
  const serializedProfile = serializeProfile(profileEntries)

  const userProfile = getUserProfile(db)
  const candidateFacts: CandidateFacts = {
    yoe: userProfile.yoe,
    yoe_industry: userProfile.yoe_industry,
    languages: userProfile.languages,
    citizenship: userProfile.citizenship,
    drivers_license: userProfile.drivers_license,
  }

  const client = new Anthropic({ apiKey })
  const now = new Date().toISOString()

  const updatePosting = db.prepare(
    `UPDATE job_postings
     SET affinity_score      = @score,
         affinity_scored_at  = @scored_at,
         affinity_skipped    = 0,
         affinity_reasoning  = @reasoning,
         description_snippet = @description_snippet,
         hard_reqs_class     = @hard_reqs_class,
         nice_to_haves_class = @nice_to_haves_class,
         yoe_min             = @yoe_min,
         yoe_max             = @yoe_max,
         seniority           = @seniority,
         tech_stack          = @tech_stack,
         salary_min          = @salary_min,
         salary_max          = @salary_max
     WHERE id = @id`,
  )

  const limit = makeSemaphore(10)

  async function scoreOne(posting: JobPosting): Promise<void> {
    const jd = posting.raw_text ?? `${posting.title} at ${posting.company}`

    let result: AffinityResult

    try {
      const response = await withQuotaGuard(
        () => client.messages.create({
          model: MODEL,
          max_tokens: 768,
          messages: [
            {
              role: 'user',
              content: buildScoringPrompt(
                posting.id,
                posting.title,
                posting.company,
                jd,
                serializedProfile,
                intent,
                candidateFacts,
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
      const validated = AffinityResultSchema.safeParse(JSON.parse(cleaned))
      if (!validated.success) throw new Error('schema mismatch')
      result = validated.data
    } catch {
      // Leave score null so this posting is retried on the next scoring run
      updatePosting.run({
        score: null,
        scored_at: null,
        id: posting.id,
        reasoning: null,
        description_snippet: null,
        hard_reqs_class: null,
        nice_to_haves_class: null,
        yoe_min: posting.yoe_min ?? null,
        yoe_max: posting.yoe_max ?? null,
        seniority: posting.seniority,
        tech_stack: JSON.stringify(posting.tech_stack),
        salary_min: posting.salary_min ?? null,
        salary_max: posting.salary_max ?? null,
      })
      return
    }

    updatePosting.run({
      score: computeAffinityScore(result.hard_reqs_class, result.nice_to_haves_class),
      scored_at: now,
      id: posting.id,
      reasoning: result.reasoning,
      description_snippet: clampSnippet(result.description_snippet),
      hard_reqs_class: result.hard_reqs_class,
      nice_to_haves_class: result.nice_to_haves_class,
      yoe_min: result.yoe_min,
      yoe_max: result.yoe_max,
      seniority: result.seniority,
      tech_stack: JSON.stringify(result.tech_stack),
      salary_min: result.salary_min,
      salary_max: result.salary_max,
    })
  }

  await Promise.all(candidates.map((p) => limit(() => scoreOne(p))))
}

function clampSnippet(s: string | null | undefined): string | null {
  if (!s) return null
  const trimmed = s.trim()
  if (!trimmed) return null
  if (trimmed.length <= MAX_SNIPPET_CHARS) return trimmed
  return trimmed.slice(0, MAX_SNIPPET_CHARS - 1) + '…'
}

export async function scorePosting(
  db: Database.Database,
  apiKey: string,
  posting: JobPosting,
  onQuotaError?: QuotaErrorCallback,
): Promise<JobPosting> {
  const intent =
    (db.prepare('SELECT intent FROM search_config WHERE id = 1').get() as { intent: string | null })
      ?.intent ?? ''
  const serializedProfile = serializeProfile(getAllEntries(db))
  const userProfile = getUserProfile(db)
  const candidateFacts: CandidateFacts = {
    yoe: userProfile.yoe,
    yoe_industry: userProfile.yoe_industry,
    languages: userProfile.languages,
    citizenship: userProfile.citizenship,
    drivers_license: userProfile.drivers_license,
  }
  const client = new Anthropic({ apiKey })
  const now = new Date().toISOString()

  const updatePosting = db.prepare(
    `UPDATE job_postings
     SET affinity_score      = @score,
         affinity_scored_at  = @scored_at,
         affinity_skipped    = 0,
         affinity_reasoning  = @reasoning,
         description_snippet = @description_snippet,
         hard_reqs_class     = @hard_reqs_class,
         nice_to_haves_class = @nice_to_haves_class,
         yoe_min             = @yoe_min,
         yoe_max             = @yoe_max,
         seniority           = @seniority,
         tech_stack          = @tech_stack,
         salary_min          = @salary_min,
         salary_max          = @salary_max
     WHERE id = @id`,
  )

  const jd = posting.raw_text ?? `${posting.title} at ${posting.company}`
  try {
    const response = await withQuotaGuard(
      () => client.messages.create({
        model: MODEL,
        max_tokens: 512,
        messages: [
          {
            role: 'user',
            content: buildScoringPrompt(
              posting.id, posting.title, posting.company, jd, serializedProfile, intent, candidateFacts,
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
    const validated = AffinityResultSchema.safeParse(JSON.parse(cleaned))
    if (!validated.success) throw new Error('schema mismatch')
    const result = validated.data
    const score = computeAffinityScore(result.hard_reqs_class, result.nice_to_haves_class)
    const description_snippet = clampSnippet(result.description_snippet)
    updatePosting.run({
      score,
      scored_at: now,
      id: posting.id,
      reasoning: result.reasoning,
      description_snippet,
      hard_reqs_class: result.hard_reqs_class,
      nice_to_haves_class: result.nice_to_haves_class,
      yoe_min: result.yoe_min,
      yoe_max: result.yoe_max,
      seniority: result.seniority,
      tech_stack: JSON.stringify(result.tech_stack),
      salary_min: result.salary_min,
      salary_max: result.salary_max,
    })
    return {
      ...posting,
      yoe_min: result.yoe_min,
      yoe_max: result.yoe_max,
      seniority: result.seniority,
      tech_stack: result.tech_stack,
      salary_min: result.salary_min,
      salary_max: result.salary_max,
      affinity_score: score,
      affinity_scored_at: now,
      affinity_skipped: false,
      affinity_reasoning: result.reasoning,
      description_snippet,
      hard_reqs_class: result.hard_reqs_class,
      nice_to_haves_class: result.nice_to_haves_class,
    }
  } catch {
    return posting
  }
}
