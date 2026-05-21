import React, { useState, useEffect, useRef } from 'react'
import type {
    SearchTerm,
    AdapterInfo,
    AdapterProgress,
    CaptchaRequest,
    LoginRequest,
    AddSearchTermData,
    GenConstraints,
    SearchTermSeniority,
    WorkType,
    Recency,
} from '../../shared/ipc-types'
import type { ScrapeState } from '../../App'
import { ConditionChip } from '../../components/ConditionChip'
import { AdapterStatusBadge } from '../../components/AdapterStatusBadge'
import { LocationTagInput } from './LocationTagInput'

export interface ScrapeProps {
    scrapeState: ScrapeState
    adapterProgress: Record<string, AdapterProgress>
    errorMsg: string | null
    captchaQueue: CaptchaRequest[]
    loginQueue: LoginRequest[]
    onRunScrape: (adapterIds: string[], loginAdapterIds: string[]) => void
    onPause: () => void
    onResume: () => void
    onAbort: () => void
    onResolveCaptcha: (adapterId: string) => void
    onResolveLogin: (adapterId: string) => void
}

export function IntentTab({
    scrapeState,
    adapterProgress,
    errorMsg,
    captchaQueue,
    loginQueue,
    onRunScrape,
    onPause,
    onResume,
    onAbort,
    onResolveCaptcha,
    onResolveLogin,
}: ScrapeProps): React.ReactElement {
    const [intent, setIntent] = useState('')
    const [terms, setTerms] = useState<SearchTerm[]>([])
    const [generating, setGenerating] = useState(false)
    const [generateError, setGenerateError] = useState<string | null>(null)
    const [adapters, setAdapters] = useState<AdapterInfo[]>([])
    const [selectedAdapters, setSelectedAdapters] = useState<Set<string>>(new Set())
    const [loginAdapters, setLoginAdapters] = useState<Set<string>>(new Set())

    const emptyTermData: AddSearchTermData = { role: '', locations: null, seniorities: null, work_type: null, recency: null, max_results: null }
    const [newTermData, setNewTermData] = useState<AddSearchTermData>(emptyTermData)
    const [genConstraints, setGenConstraints] = useState<GenConstraints>({ locations: null, seniorities: null, work_type: null, recency: null, max_results: null })
    const [editingId, setEditingId] = useState<string | null>(null)
    const intentRef = useRef(intent)
    intentRef.current = intent

    useEffect(() => {
        window.api.getSearchConfig().then((cfg) => setIntent(cfg.intent ?? ''))
        window.api.getSearchTerms().then(setTerms)
        window.api.listAdapters().then((list) => {
            setAdapters(list)
            setSelectedAdapters(new Set(list.filter((a) => a.available && a.id !== 'mock').map((a) => a.id)))
        })
    }, [])

    function handleIntentBlur(): void {
        window.api.updateSearchConfig({ intent: intentRef.current || null }).catch(console.error)
    }

    async function handleGenerate(): Promise<void> {
        setGenerating(true)
        setGenerateError(null)
        try {
            const generated = await window.api.generateSearchTerms(genConstraints)
            setTerms((prev) => [...prev, ...generated])
        } catch (err) {
            setGenerateError(err instanceof Error ? err.message : String(err))
        } finally {
            setGenerating(false)
        }
    }

    async function handleGenerateFromProfile(): Promise<void> {
        setGenerating(true)
        setGenerateError(null)
        try {
            const generated = await window.api.generateSearchTermsFromProfile(genConstraints)
            setTerms((prev) => [...prev, ...generated])
        } catch (err) {
            setGenerateError(err instanceof Error ? err.message : String(err))
        } finally {
            setGenerating(false)
        }
    }

    async function handleToggle(id: string, enabled: boolean): Promise<void> {
        setTerms((prev) => prev.map((t) => (t.id === id ? { ...t, enabled } : t)))
        await window.api.updateSearchTerm(id, { enabled })
    }

    async function handleDelete(id: string): Promise<void> {
        await window.api.deleteSearchTerm(id)
        setTerms((prev) => prev.filter((t) => t.id !== id))
    }

    async function handleDuplicate(t: SearchTerm): Promise<void> {
        const added = await window.api.addSearchTerm({
            role: `${t.term} (copy)`,
            locations: t.locations,
            seniorities: t.seniorities,
            work_type: t.work_type,
            recency: t.recency,
            max_results: t.max_results,
        })
        setTerms((prev) => [...prev, added])
    }

    function openEdit(t: SearchTerm): void {
        setEditingId(t.id)
        setNewTermData({ role: t.term, locations: t.locations, seniorities: t.seniorities, work_type: t.work_type, recency: t.recency, max_results: t.max_results })
    }

    function cancelEdit(): void {
        setEditingId(null)
        setNewTermData(emptyTermData)
    }

    async function handleAddTerm(): Promise<void> {
        if (!newTermData.role.trim()) return
        if (editingId) {
            await window.api.updateSearchTerm(editingId, {
                term: newTermData.role,
                locations: newTermData.locations,
                seniorities: newTermData.seniorities,
                work_type: newTermData.work_type,
                recency: newTermData.recency,
                max_results: newTermData.max_results,
            })
            setTerms((prev) =>
                prev.map((t) =>
                    t.id === editingId
                        ? { ...t, term: newTermData.role, locations: newTermData.locations ?? null, seniorities: newTermData.seniorities ?? null, work_type: newTermData.work_type ?? null, recency: newTermData.recency ?? null, max_results: newTermData.max_results ?? null }
                        : t
                )
            )
            setEditingId(null)
            setNewTermData(emptyTermData)
        } else {
            const added = await window.api.addSearchTerm(newTermData)
            setTerms((prev) => [...prev, added])
            setNewTermData(emptyTermData)
        }
    }

    function handleRunScrape(): void {
        const adapterIds = Array.from(selectedAdapters)
        const loginIds = Array.from(loginAdapters).filter((id) => selectedAdapters.has(id))
        onRunScrape(adapterIds, loginIds)
    }

    return (
        <div>
            {/* Intent */}
            <section style={{ marginBottom: '28px' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
                    Search Intent
                </label>
                <p style={{ margin: '0 0 8px', fontSize: '0.85rem', color: '#6b7280' }}>
                    Describe the role you're targeting. Used to generate search terms and rank results.
                </p>
                <textarea
                    data-testid="search-intent-input"
                    value={intent}
                    onChange={(e) => setIntent(e.target.value)}
                    onBlur={handleIntentBlur}
                    placeholder="e.g. Senior backend engineer, fintech or B2B SaaS, remote, Go or TypeScript"
                    rows={3}
                    style={{
                        display: 'block',
                        width: '100%',
                        boxSizing: 'border-box',
                        fontFamily: 'inherit',
                        fontSize: '0.875rem',
                        padding: '8px',
                        borderRadius: '4px',
                        border: '1px solid #d1d5db',
                        resize: 'vertical',
                    }}
                />
            </section>

            {/* Generation constraints */}
            <section style={{ marginBottom: '28px' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
                    Generation Constraints <span style={{ fontWeight: 400, fontSize: '0.8rem', color: '#6b7280' }}>(optional — applied to all generated terms)</span>
                </label>
                <div data-testid="gen-constraints" style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '14px', background: '#f9fafb' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                        <div style={{ gridColumn: '1 / -1' }}>
                            <label style={{ display: 'block', fontSize: '0.75rem', color: '#6b7280', marginBottom: '3px' }}>Location(s)</label>
                            <LocationTagInput
                                values={genConstraints.locations ?? []}
                                onChange={(tags) => setGenConstraints((p) => ({ ...p, locations: tags.length ? tags : null }))}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', color: '#6b7280', marginBottom: '5px' }}>Seniority</label>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                {(['intern', 'junior', 'mid', 'senior', 'staff'] as SearchTermSeniority[]).map((level) => (
                                    <label key={level} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.825rem', cursor: 'pointer' }}>
                                        <input
                                            type="checkbox"
                                            checked={(genConstraints.seniorities ?? []).includes(level)}
                                            onChange={(e) => {
                                                setGenConstraints((p) => {
                                                    const cur = p.seniorities ?? []
                                                    const next = e.target.checked ? [...cur, level] : cur.filter((s) => s !== level)
                                                    return { ...p, seniorities: next.length ? next : null }
                                                })
                                            }}
                                        />
                                        {level.charAt(0).toUpperCase() + level.slice(1)}
                                    </label>
                                ))}
                            </div>
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', color: '#6b7280', marginBottom: '5px' }}>Work Type</label>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                {(['remote', 'hybrid', 'onsite'] as WorkType[]).map((wt) => (
                                    <label key={wt} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.825rem', cursor: 'pointer' }}>
                                        <input
                                            type="checkbox"
                                            checked={(genConstraints.work_type ?? []).includes(wt)}
                                            onChange={(e) => {
                                                setGenConstraints((p) => {
                                                    const cur = p.work_type ?? []
                                                    const next = e.target.checked ? [...cur, wt] : cur.filter((w) => w !== wt)
                                                    return { ...p, work_type: next.length ? next : null }
                                                })
                                            }}
                                        />
                                        {wt.charAt(0).toUpperCase() + wt.slice(1)}
                                    </label>
                                ))}
                            </div>
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', color: '#6b7280', marginBottom: '3px' }}>Recency</label>
                            <select
                                value={genConstraints.recency ?? ''}
                                onChange={(e) => setGenConstraints((p) => ({ ...p, recency: (e.target.value || null) as Recency | null }))}
                                style={{ width: '100%', boxSizing: 'border-box', padding: '5px 7px', fontSize: '0.875rem', border: '1px solid #d1d5db', borderRadius: '4px', fontFamily: 'inherit', background: 'white' }}
                            >
                                <option value="">Any time</option>
                                <option value="day">Past day</option>
                                <option value="week">Past week</option>
                                <option value="month">Past month</option>
                            </select>
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', color: '#6b7280', marginBottom: '3px' }}>Max results</label>
                            <input
                                type="number"
                                min={1}
                                value={genConstraints.max_results ?? ''}
                                onChange={(e) => setGenConstraints((p) => ({ ...p, max_results: e.target.value ? parseInt(e.target.value, 10) : null }))}
                                placeholder="unlimited"
                                style={{ width: '100%', boxSizing: 'border-box', padding: '5px 7px', fontSize: '0.875rem', border: '1px solid #d1d5db', borderRadius: '4px', fontFamily: 'inherit' }}
                            />
                        </div>
                    </div>
                </div>
            </section>

            {/* Search Terms */}
            <section style={{ marginBottom: '28px' }}>
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '10px',
                    }}
                >
                    <h3 style={{ margin: 0, fontSize: '1rem' }}>Search Terms</h3>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                            data-testid="search-generate-btn"
                            onClick={handleGenerate}
                            disabled={generating}
                            style={{ padding: '6px 14px', fontWeight: 600, cursor: 'pointer' }}
                        >
                            {generating ? 'Generating…' : 'Generate from Intent'}
                        </button>
                        <button
                            data-testid="search-generate-from-profile-btn"
                            onClick={handleGenerateFromProfile}
                            disabled={generating}
                            style={{ padding: '6px 14px', fontWeight: 600, cursor: 'pointer' }}
                        >
                            {generating ? 'Generating…' : 'Generate from Profile'}
                        </button>
                    </div>
                </div>

                {generateError && (
                    <div style={{ marginBottom: '8px', color: 'crimson', fontSize: '0.85rem' }}>
                        {generateError}
                    </div>
                )}

                {terms.length === 0 ? (
                    <p style={{ fontSize: '0.85rem', color: '#6b7280' }}>
                        No terms yet. Generate some from your intent or add them manually.
                    </p>
                ) : (
                    <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 12px' }}>
                        {terms.map((t) => (
                            <li
                                key={t.id}
                                data-testid={`search-term-item-${t.id}`}
                                style={{
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: '8px',
                                    padding: '6px 0',
                                    borderBottom: '1px solid #f3f4f6',
                                }}
                            >
                                <input
                                    data-testid={`search-term-toggle-${t.id}`}
                                    type="checkbox"
                                    checked={t.enabled}
                                    style={{ marginTop: '2px' }}
                                    onChange={(e) => handleToggle(t.id, e.target.checked)}
                                />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <span
                                        style={{
                                            fontSize: '0.875rem',
                                            textDecoration: t.enabled ? 'none' : 'line-through',
                                            color: t.enabled ? undefined : '#9ca3af',
                                        }}
                                    >
                                        {t.term}
                                    </span>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                                        {t.locations?.map((loc) => <ConditionChip key={loc} label={loc} />)}
                                        {t.seniorities?.map((s) => <ConditionChip key={s} label={s} />)}
                                        {t.work_type?.map((w) => <ConditionChip key={w} label={w} color="#dbeafe" />)}
                                        {t.recency && <ConditionChip label={{ day: 'past day', week: 'past week', month: 'past month' }[t.recency]} />}
                                        {t.max_results != null && <ConditionChip label={`max ${t.max_results}`} />}
                                    </div>
                                </div>
                                <span
                                    style={{
                                        fontSize: '0.7rem',
                                        color: '#9ca3af',
                                        background: '#f3f4f6',
                                        padding: '1px 6px',
                                        borderRadius: '999px',
                                        whiteSpace: 'nowrap',
                                        flexShrink: 0,
                                    }}
                                >
                                    {t.source === 'llm_generated' ? 'AI' : 'manual'}
                                </span>
                                <button
                                    data-testid={`search-term-edit-${t.id}`}
                                    onClick={() => openEdit(t)}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        cursor: 'pointer',
                                        color: '#6b7280',
                                        padding: '0 4px',
                                        fontSize: '0.85rem',
                                        flexShrink: 0,
                                    }}
                                    title="Edit"
                                >
                                    ✎
                                </button>
                                <button
                                    data-testid={`search-term-duplicate-${t.id}`}
                                    onClick={() => handleDuplicate(t)}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        cursor: 'pointer',
                                        color: '#6b7280',
                                        padding: '0 4px',
                                        fontSize: '0.85rem',
                                        flexShrink: 0,
                                    }}
                                    title="Duplicate"
                                >
                                    ⎘
                                </button>
                                <button
                                    data-testid={`search-term-delete-${t.id}`}
                                    onClick={() => handleDelete(t.id)}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        cursor: 'pointer',
                                        color: '#6b7280',
                                        padding: '0 4px',
                                        fontSize: '0.85rem',
                                        flexShrink: 0,
                                    }}
                                    title="Delete"
                                >
                                    ×
                                </button>
                            </li>
                        ))}
                    </ul>
                )}

                {/* Structured add form */}
                <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '14px', background: '#f9fafb' }}>
                    <p style={{ margin: '0 0 10px', fontSize: '0.8rem', fontWeight: 600, color: '#374151' }}>{editingId ? 'Edit term' : 'Add term manually'}</p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', color: '#6b7280', marginBottom: '3px' }}>Role *</label>
                            <input
                                data-testid="search-add-role"
                                value={newTermData.role}
                                onChange={(e) => setNewTermData((p) => ({ ...p, role: e.target.value }))}
                                onKeyDown={(e) => e.key === 'Enter' && handleAddTerm()}
                                placeholder="e.g. senior backend engineer"
                                style={{ width: '100%', boxSizing: 'border-box', padding: '5px 7px', fontSize: '0.875rem', border: '1px solid #d1d5db', borderRadius: '4px', fontFamily: 'inherit' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', color: '#6b7280', marginBottom: '3px' }}>Recency</label>
                            <select
                                data-testid="search-add-recency"
                                value={newTermData.recency ?? ''}
                                onChange={(e) => setNewTermData((p) => ({ ...p, recency: (e.target.value || null) as Recency | null }))}
                                style={{ width: '100%', boxSizing: 'border-box', padding: '5px 7px', fontSize: '0.875rem', border: '1px solid #d1d5db', borderRadius: '4px', fontFamily: 'inherit', background: 'white' }}
                            >
                                <option value="">Any time</option>
                                <option value="day">Past day</option>
                                <option value="week">Past week</option>
                                <option value="month">Past month</option>
                            </select>
                        </div>
                        <div style={{ gridColumn: '1 / -1' }}>
                            <label style={{ display: 'block', fontSize: '0.75rem', color: '#6b7280', marginBottom: '3px' }}>Location(s)</label>
                            <LocationTagInput
                                values={newTermData.locations ?? []}
                                onChange={(tags) => setNewTermData((p) => ({ ...p, locations: tags.length ? tags : null }))}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', color: '#6b7280', marginBottom: '5px' }}>Seniority</label>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                {(['intern', 'junior', 'mid', 'senior', 'staff'] as SearchTermSeniority[]).map((level) => (
                                    <label key={level} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.825rem', cursor: 'pointer' }}>
                                        <input
                                            type="checkbox"
                                            checked={(newTermData.seniorities ?? []).includes(level)}
                                            onChange={(e) => {
                                                setNewTermData((p) => {
                                                    const cur = p.seniorities ?? []
                                                    const next = e.target.checked ? [...cur, level] : cur.filter((s) => s !== level)
                                                    return { ...p, seniorities: next.length ? next : null }
                                                })
                                            }}
                                        />
                                        {level.charAt(0).toUpperCase() + level.slice(1)}
                                    </label>
                                ))}
                            </div>
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', color: '#6b7280', marginBottom: '5px' }}>Work Type</label>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                {(['remote', 'hybrid', 'onsite'] as WorkType[]).map((wt) => (
                                    <label key={wt} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.825rem', cursor: 'pointer' }}>
                                        <input
                                            type="checkbox"
                                            checked={(newTermData.work_type ?? []).includes(wt)}
                                            onChange={(e) => {
                                                setNewTermData((p) => {
                                                    const cur = p.work_type ?? []
                                                    const next = e.target.checked ? [...cur, wt] : cur.filter((w) => w !== wt)
                                                    return { ...p, work_type: next.length ? next : null }
                                                })
                                            }}
                                        />
                                        {wt.charAt(0).toUpperCase() + wt.slice(1)}
                                    </label>
                                ))}
                            </div>
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', color: '#6b7280', marginBottom: '3px' }}>Max results</label>
                            <input
                                data-testid="search-add-max-results"
                                type="number"
                                min={1}
                                value={newTermData.max_results ?? ''}
                                onChange={(e) => setNewTermData((p) => ({ ...p, max_results: e.target.value ? parseInt(e.target.value, 10) : null }))}
                                placeholder="75"
                                style={{ width: '100%', boxSizing: 'border-box', padding: '5px 7px', fontSize: '0.875rem', border: '1px solid #d1d5db', borderRadius: '4px', fontFamily: 'inherit' }}
                            />
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                            data-testid="search-add-btn"
                            onClick={handleAddTerm}
                            disabled={!newTermData.role.trim()}
                            style={{ padding: '6px 16px', cursor: 'pointer', fontWeight: 600 }}
                        >
                            {editingId ? 'Save' : 'Add'}
                        </button>
                        {editingId && (
                            <button
                                data-testid="search-edit-cancel-btn"
                                onClick={cancelEdit}
                                style={{ padding: '6px 16px', cursor: 'pointer' }}
                            >
                                Cancel
                            </button>
                        )}
                    </div>
                </div>
            </section>

            {/* Adapter + scrape */}
            <section>
                <h3 style={{ marginTop: 0, marginBottom: '12px', fontSize: '1rem' }}>Run Scrape</h3>
                <div
                    role="alert"
                    style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '10px',
                        padding: '10px 12px',
                        marginBottom: '12px',
                        background: '#fef3c7',
                        border: '1px solid #fcd34d',
                        borderRadius: '6px',
                        fontSize: '0.85rem',
                        color: '#78350f',
                        lineHeight: 1.4,
                    }}
                >
                    <span aria-hidden="true" style={{ fontSize: '1rem', lineHeight: 1 }}>⚠</span>
                    <span>
                        <strong>Turn off your VPN before running a scrape.</strong> Job sites
                        flag VPN exit nodes and will block the crawl with repeated CAPTCHAs.
                    </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                    {adapters.map((adapter) => (
                        <div
                            key={adapter.id}
                            style={{
                                border: '1px solid #e5e7eb',
                                borderRadius: '8px',
                                padding: '12px 16px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                opacity: adapter.available ? 1 : 0.5,
                            }}
                        >
                            <input
                                data-testid={`adapter-checkbox-${adapter.id}`}
                                type="checkbox"
                                checked={selectedAdapters.has(adapter.id)}
                                disabled={
                                    !adapter.available ||
                                    scrapeState === 'running' ||
                                    scrapeState === 'paused'
                                }
                                onChange={(e) => {
                                    setSelectedAdapters((prev) => {
                                        const next = new Set(prev)
                                        if (e.target.checked) next.add(adapter.id)
                                        else next.delete(adapter.id)
                                        return next
                                    })
                                }}
                                style={{ cursor: adapter.available ? 'pointer' : 'not-allowed', flexShrink: 0 }}
                            />
                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 600 }}>{adapter.name}</div>
                                <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '2px' }}>
                                    {adapter.description}
                                </div>
                            </div>
                            {adapter.supportsLogin && (
                                <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.8rem', color: '#374151', cursor: 'pointer', flexShrink: 0 }}>
                                    <input
                                        data-testid={`adapter-login-${adapter.id}`}
                                        type="checkbox"
                                        checked={loginAdapters.has(adapter.id)}
                                        disabled={
                                            !adapter.available ||
                                            !selectedAdapters.has(adapter.id) ||
                                            scrapeState === 'running' ||
                                            scrapeState === 'paused'
                                        }
                                        onChange={(e) => {
                                            setLoginAdapters((prev) => {
                                                const next = new Set(prev)
                                                if (e.target.checked) next.add(adapter.id)
                                                else next.delete(adapter.id)
                                                return next
                                            })
                                        }}
                                        style={{ cursor: 'inherit' }}
                                    />
                                    Login first
                                </label>
                            )}
                            <AdapterStatusBadge
                                progress={adapterProgress[adapter.id]}
                                available={adapter.available}
                            />
                        </div>
                    ))}
                </div>
                <button
                    data-testid="search-run-scrape-btn"
                    onClick={handleRunScrape}
                    disabled={
                        scrapeState === 'running' ||
                        scrapeState === 'paused' ||
                        selectedAdapters.size === 0
                    }
                    style={{ padding: '8px 16px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                    {scrapeState === 'running' ? 'Running…' : scrapeState === 'paused' ? 'Paused' : 'Run Scrape'}
                </button>

                {(scrapeState === 'running' || scrapeState === 'paused') && (
                    <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                        {scrapeState === 'running' ? (
                            <button
                                data-testid="search-pause-btn"
                                onClick={onPause}
                                style={{ padding: '6px 14px', cursor: 'pointer' }}
                            >
                                Pause
                            </button>
                        ) : (
                            <button
                                data-testid="search-resume-btn"
                                onClick={onResume}
                                style={{ padding: '6px 14px', cursor: 'pointer', fontWeight: 600 }}
                            >
                                Resume
                            </button>
                        )}
                        <button
                            data-testid="search-abort-btn"
                            onClick={onAbort}
                            style={{ padding: '6px 14px', cursor: 'pointer', color: '#dc2626' }}
                        >
                            Stop
                        </button>
                    </div>
                )}

                {loginQueue.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
                        {loginQueue.map((req) => (
                            <div
                                key={req.adapterId}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '12px',
                                    border: '1px solid #3b82f6',
                                    borderRadius: '8px',
                                    padding: '12px 16px',
                                    background: '#eff6ff',
                                    fontSize: '0.875rem',
                                }}
                            >
                                <span style={{ flex: 1 }}>
                                    Log in to <strong>{req.adapterName}</strong> in the browser window that opened,
                                    then click <strong>Done</strong>.
                                </span>
                                <button
                                    data-testid={`login-done-${req.adapterId}`}
                                    onClick={() => onResolveLogin(req.adapterId)}
                                    style={{
                                        padding: '6px 14px',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        background: '#2563eb',
                                        color: '#fff',
                                        border: 'none',
                                        borderRadius: '6px',
                                        flexShrink: 0,
                                    }}
                                >
                                    Done
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {captchaQueue.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
                        {captchaQueue.map((req) => (
                            <div
                                key={req.adapterId}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '12px',
                                    border: '1px solid #fbbf24',
                                    borderRadius: '8px',
                                    padding: '12px 16px',
                                    background: '#fffbeb',
                                    fontSize: '0.875rem',
                                }}
                            >
                                <span style={{ fontSize: '1.1rem' }}>&#9888;&#65039;</span>
                                <span style={{ flex: 1 }}>
                                    <strong>{req.adapterName}</strong> is paused for captcha verification.
                                    Solve it in the browser window that opened, then click <strong>Continue</strong>.
                                </span>
                                <button
                                    onClick={() => onResolveCaptcha(req.adapterId)}
                                    style={{
                                        padding: '6px 14px',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        background: '#2563eb',
                                        color: '#fff',
                                        border: 'none',
                                        borderRadius: '6px',
                                        flexShrink: 0,
                                    }}
                                >
                                    Continue
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {scrapeState === 'error' && errorMsg && (
                    <div data-testid="search-error" style={{ marginTop: '12px', color: 'crimson', fontSize: '0.85rem' }}>
                        {errorMsg}
                    </div>
                )}
            </section>
        </div>
    )
}
