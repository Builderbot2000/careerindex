import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import Database from 'better-sqlite3'
import { serializeProfile } from '../resume/agent'
import { getAllEntries } from './repository'
import { withQuotaGuard, type QuotaErrorCallback } from '../llm/withQuotaGuard'
import { writeLLMUsage } from '../jobs/llmUsage'
import {
  INDUSTRIES,
  LANGUAGES,
  LANGUAGE_PROFICIENCIES,
  COUNTRIES,
  CITIZENSHIP_STATUSES,
} from './qualsVocab'
import {
  UserQualificationsSchema,
  type UserQualificationsInput,
} from './models'

const MODEL = 'claude-haiku-4-5'

const ExtractedSchema = UserQualificationsSchema.extend({
  yoe_industry: z.array(z.enum(INDUSTRIES as [string, ...string[]])),
})

function buildPrompt(serializedProfile: string): string {
  return `Extract structured General qualifications from the candidate's profile.

You must pick values from the provided enumerations exactly — do not invent new strings, translations, or close variants. If a piece of information is not clearly stated or strongly implied in the profile, omit it rather than guessing.

## Profile
${serializedProfile}

## Allowed values
INDUSTRIES (pick zero or more): ${JSON.stringify(INDUSTRIES)}
LANGUAGES (pick zero or more): ${JSON.stringify(LANGUAGES)}
LANGUAGE_PROFICIENCIES (one per language): ${JSON.stringify(LANGUAGE_PROFICIENCIES)}
COUNTRIES (for citizenship): ${JSON.stringify(COUNTRIES)}
CITIZENSHIP_STATUSES (one per citizenship): ${JSON.stringify(CITIZENSHIP_STATUSES)}

## Output
Return ONLY valid JSON, no markdown:
{
  "yoe_industry": [<industries the candidate has experience in — pick from INDUSTRIES>],
  "languages": [{"name": "<from LANGUAGES>", "proficiency": "<from LANGUAGE_PROFICIENCIES>"}],
  "citizenship": [{"country": "<from COUNTRIES>", "status": "<from CITIZENSHIP_STATUSES>"}],
  "drivers_license": <true if the profile mentions one, else false>
}

## Rules
- Industries: only those clearly evidenced by employment history (e.g. a stint at a healthcare company → "Healthcare & Life Sciences"). Don't add an industry just because the candidate worked with a related technology.
- Languages: default to English at "Full Professional" if the profile is written in fluent English and no other signal contradicts. Add other languages only when explicitly mentioned.
- Citizenship: only if explicitly stated in the profile (e.g. "US citizen", "permanent resident of Canada"). Omit the whole array if nothing is stated.
- drivers_license: true only if explicitly stated.`
}

export interface QualsExtractionResult {
  qualifications: UserQualificationsInput
}

export async function extractQualifications(
  db: Database.Database,
  apiKey: string,
  onQuotaError?: QuotaErrorCallback,
): Promise<QualsExtractionResult> {
  const entries = getAllEntries(db)
  if (entries.length === 0) {
    return {
      qualifications: { yoe_industry: [], languages: [], citizenship: [], drivers_license: false },
    }
  }

  const client = new Anthropic({ apiKey })
  const response = await withQuotaGuard(
    () => client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: buildPrompt(serializeProfile(entries).slice(0, 8000)),
        },
      ],
    }),
    onQuotaError,
  )

  writeLLMUsage(db, {
    call_type: 'affinity_scoring', // re-use; cheap call
    model: MODEL,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    posting_id: null,
  })

  const raw = response.content.find((b) => b.type === 'text')?.text ?? ''
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  const parsed = ExtractedSchema.safeParse(JSON.parse(cleaned))
  if (!parsed.success) throw new Error(`extraction schema mismatch: ${parsed.error.message}`)

  return { qualifications: parsed.data }
}
