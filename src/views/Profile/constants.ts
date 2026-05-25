import type { ProfileEntryType } from '../../shared/ipc-types'

export const ENTRY_TYPES: ProfileEntryType[] = [
    'experience',
    'credential',
    'accomplishment',
    'skill',
    'education',
]

export const TYPE_LABELS: Record<ProfileEntryType, string> = {
    experience: 'Experience',
    credential: 'Credential',
    accomplishment: 'Accomplishment',
    skill: 'Skill',
    education: 'Education',
}

export const TYPE_COLORS: Record<ProfileEntryType, string> = {
    experience: '#2563eb',
    credential: '#7c3aed',
    accomplishment: '#059669',
    skill: '#d97706',
    education: '#dc2626',
}

export type FilterType = ProfileEntryType | 'all' | 'general'

export interface FormState {
    type: ProfileEntryType
    title: string
    content: string
    tagsRaw: string
    start_date: string
    end_date: string
}

export function blankForm(type: ProfileEntryType = 'experience'): FormState {
    return { type, title: '', content: '', tagsRaw: '', start_date: '', end_date: '' }
}

export function countWords(text: string): number {
    const t = text.trim()
    return t ? t.split(/\s+/).length : 0
}

// ─── General tab reference data ───────────────────────────────────────────────
// Vocab lives in core/profile/qualsVocab so the main-process LLM extractor can
// constrain its output to the same values the UI dropdowns offer.

export {
    INDUSTRIES,
    LANGUAGES,
    LANGUAGE_PROFICIENCIES,
    COUNTRIES,
    CITIZENSHIP_STATUSES,
} from '../../../core/profile/qualsVocab'
