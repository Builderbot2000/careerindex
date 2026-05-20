import React, { useState, useEffect, useCallback, useRef } from 'react'
import type { TrackerPosting, PostingStatus } from '../shared/ipc-types'
import { AffinityBadge } from '../components/AffinityBadge'
import { AffinityReasonModal } from '../components/AffinityReasonModal'
import { ApplyConfirmModal } from '../components/ApplyConfirmModal'
import { Pagination } from '../components/Pagination'

const PAGE_SIZE = 20

type SortKey =
    | 'company'
    | 'applied'
    | 'title'
    | 'seniority'
    | 'location'
    | 'source'
    | 'posted'
    | 'fit'
    | 'status'
type SortDir = 'asc' | 'desc'

const SENIORITY_ORDER = ['intern', 'junior', 'mid', 'senior', 'staff', 'any']
const STATUS_ORDER: PostingStatus[] = ['new', 'viewed', 'favorited', 'applied', 'interviewing', 'offer', 'rejected', 'ghosted']

function getComparator(key: SortKey, dir: SortDir): (a: TrackerPosting, b: TrackerPosting) => number {
    const sign = dir === 'asc' ? 1 : -1
    return (a, b) => {
        let av: number, bv: number
        switch (key) {
            case 'company':  return sign * a.company.localeCompare(b.company)
            case 'title':    return sign * a.title.localeCompare(b.title)
            case 'location': return sign * (a.location ?? '').localeCompare(b.location ?? '')
            case 'source':   return sign * a.source.localeCompare(b.source)
            case 'seniority': {
                av = SENIORITY_ORDER.indexOf(a.seniority ?? 'any')
                bv = SENIORITY_ORDER.indexOf(b.seniority ?? 'any')
                return sign * (av - bv)
            }
            case 'status': {
                av = STATUS_ORDER.indexOf(a.status)
                bv = STATUS_ORDER.indexOf(b.status)
                return sign * (av - bv)
            }
            case 'posted': {
                av = new Date(a.posted_at ?? a.fetched_at).getTime()
                bv = new Date(b.posted_at ?? b.fetched_at).getTime()
                return sign * (av - bv)
            }
            case 'fit': {
                if (a.affinity_score == null && b.affinity_score == null) return 0
                if (a.affinity_score == null) return 1
                if (b.affinity_score == null) return -1
                return sign * (a.affinity_score - b.affinity_score)
            }
            case 'applied': {
                if (!a.applied_at && !b.applied_at) return 0
                if (!a.applied_at) return 1
                if (!b.applied_at) return -1
                return sign * (new Date(a.applied_at).getTime() - new Date(b.applied_at).getTime())
            }
        }
    }
}

const NEXT_STATUS: Partial<Record<PostingStatus, PostingStatus>> = {
    new: 'viewed',
    viewed: 'applied',
    favorited: 'applied',
    applied: 'interviewing',
    interviewing: 'offer',
}

function formatPostedAt(posted_at: string | null, fetched_at: string): string {
    const dateStr = posted_at ?? fetched_at
    const date = new Date(dateStr)
    const diffMs = Date.now() - date.getTime()
    const diffDays = Math.floor(diffMs / 86400000)
    if (diffDays === 0) return 'today'
    if (diffDays === 1) return '1d ago'
    return `${diffDays}d ago`
}

function formatDate(iso: string | null): string {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    })
}

export default function Tracker(): React.ReactElement {
    const [postings, setPostings] = useState<TrackerPosting[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [page, setPage] = useState(1)
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [sortKey, setSortKey] = useState<SortKey | null>(null)
    const [sortDir, setSortDir] = useState<SortDir>('asc')
    const [affinityModal, setAffinityModal] = useState<TrackerPosting | null>(null)
    const [confirmApplyPosting, setConfirmApplyPosting] = useState<TrackerPosting | null>(null)
    const [lastTouchedId, setLastTouchedId] = useState<string | null>(null)
    const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)
    const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const [viewMode, setViewMode] = useState<'active' | 'archived'>('active')
    const [archivedCount, setArchivedCount] = useState(0)

    function handleSort(key: SortKey): void {
        if (sortKey === key) {
            if (sortDir === 'asc') { setSortDir('desc'); setPage(1) }
            else { setSortKey(null); setSortDir('asc'); setPage(1) }
        } else {
            setSortKey(key); setSortDir('asc'); setPage(1)
        }
    }

    function sortArrow(key: SortKey): React.ReactElement {
        if (sortKey !== key) return <span style={{ color: '#d1d5db', fontSize: '0.75rem' }}>↕</span>
        return <span style={{ fontSize: '0.75rem' }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
    }

    const loadPostings = useCallback(async () => {
        try {
            const [data, count] = await Promise.all([
                viewMode === 'archived'
                    ? window.api.listArchivedTrackerPostings()
                    : window.api.getTrackerPostings(),
                window.api.getTrackerArchivedCount(),
            ])
            setPostings(data)
            setArchivedCount(count)
            setPage(1)
            setSelected(new Set())
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setLoading(false)
        }
    }, [viewMode])

    useEffect(() => {
        loadPostings()
        window.api.onAffinityUpdated((updated) => {
            if (viewMode !== 'active') return
            // Filter the broadcast list down to tracker-status rows and preserve applied_at.
            setPostings((prev) => {
                const prevById = new Map(prev.map((p) => [p.id, p]))
                return updated
                    .filter((p) => !['new', 'viewed'].includes(p.status) && p.archived_at == null)
                    .map((p) => {
                        const old = prevById.get(p.id)
                        return { ...p, applied_at: old?.applied_at ?? null }
                    })
            })
        })
        const unsubScored = window.api.onPostingScored((scored) => {
            if (viewMode !== 'active') return
            setPostings((prev) =>
                prev.map((p) => (p.id === scored.id ? { ...p, ...scored, applied_at: p.applied_at } : p)),
            )
        })
        return () => { unsubScored() }
    }, [loadPostings, viewMode])

    function toggleSelect(id: string): void {
        setSelected((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id); else next.add(id)
            return next
        })
    }

    function toggleSelectPage(): void {
        const pageIds = pagePostings?.map((p) => p.id) ?? []
        const allSelected = pageIds.every((id) => selected.has(id))
        setSelected((prev) => {
            const next = new Set(prev)
            if (allSelected) pageIds.forEach((id) => next.delete(id))
            else pageIds.forEach((id) => next.add(id))
            return next
        })
    }

    async function handleDelete(): Promise<void> {
        const ids = [...selected]
        await window.api.deletePostings(ids)
        setPostings((prev) => prev.filter((p) => !selected.has(p.id)))
        setSelected(new Set())
        if (viewMode === 'archived') {
            setArchivedCount((c) => Math.max(0, c - ids.length))
        }
    }

    async function handleUnarchive(id: string): Promise<void> {
        await window.api.unarchivePosting(id).catch(console.error)
        setPostings((prev) => prev.filter((p) => p.id !== id))
        setArchivedCount((c) => Math.max(0, c - 1))
    }

    async function handleDeleteAllArchived(): Promise<void> {
        if (!window.confirm(`Permanently delete all ${archivedCount} archived posting(s)? This cannot be undone.`)) return
        const deleted = await window.api.deleteAllTrackerArchived()
        setPostings([])
        setArchivedCount(0)
        setSelected(new Set())
        console.info(`Deleted ${deleted} archived tracker postings`)
    }

    async function handleStatusChange(id: string, status: PostingStatus): Promise<void> {
        await window.api.updatePostingStatus(id, status).catch(console.error)
        const applied_at = status === 'applied' ? new Date().toISOString() : undefined
        setPostings((prev) => prev.map((p) =>
            p.id === id
                ? { ...p, status, ...(applied_at !== undefined && p.applied_at == null ? { applied_at } : {}) }
                : p,
        ))
    }

    async function handleOpen(posting: TrackerPosting): Promise<void> {
        if (posting.status === 'new') {
            await window.api.updatePostingStatus(posting.id, 'viewed').catch(console.error)
            setPostings((prev) =>
                prev.map((p) => (p.id === posting.id ? { ...p, status: 'viewed' } : p)),
            )
        }
        await window.api.openExternal(posting.url).catch(console.error)

        const currentStatus: PostingStatus = posting.status === 'new' ? 'viewed' : posting.status
        const promptable: PostingStatus[] = ['viewed', 'favorited']
        if (promptable.includes(currentStatus)) {
            setConfirmApplyPosting({ ...posting, status: currentStatus })
        }
    }

    async function handleConfirmApplied(): Promise<void> {
        const p = confirmApplyPosting
        if (!p) return
        setConfirmApplyPosting(null)
        await window.api.updatePostingStatus(p.id, 'applied').catch(console.error)
        const applied_at = new Date().toISOString()
        setPostings((prev) => prev.map((x) =>
            x.id === p.id
                ? { ...x, status: 'applied', ...(x.applied_at == null ? { applied_at } : {}) }
                : x,
        ))
    }

    async function handleDeclineApplied(): Promise<void> {
        const p = confirmApplyPosting
        if (!p) return
        setConfirmApplyPosting(null)
        if (p.status !== 'viewed') {
            await window.api.updatePostingStatus(p.id, 'viewed').catch(console.error)
            setPostings((prev) => prev.map((x) => (x.id === p.id ? { ...x, status: 'viewed' } : x)))
        }
    }

    if (loading) return <div style={{ padding: '24px', color: '#6b7280' }}>Loading…</div>
    if (error) return <div style={{ padding: '24px', color: 'crimson' }}>Error: {error}</div>

    const sorted = sortKey ? [...postings].sort(getComparator(sortKey, sortDir)) : postings
    const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
    const pagePostings = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

    const allPageSelected = pagePostings.length > 0 && pagePostings.every((p) => selected.has(p.id))
    const somePageSelected = pagePostings.some((p) => selected.has(p.id))
    const isArchived = viewMode === 'archived'

    return (
        <div style={{ padding: '24px', overflowY: 'auto', height: '100%', boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                <h2 style={{ margin: 0 }}>
                    {isArchived ? 'Archived Tracker' : 'Tracker'}{' '}
                    <span style={{ fontSize: '0.85rem', fontWeight: 400, color: '#6b7280' }}>
                        ({postings.length})
                    </span>
                </h2>
                {selected.size > 0 && (
                    <button
                        onClick={handleDelete}
                        style={{
                            fontSize: '0.8rem',
                            padding: '4px 12px',
                            cursor: 'pointer',
                            background: '#dc2626',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '4px',
                            fontWeight: 600,
                        }}
                    >
                        Delete ({selected.size})
                    </button>
                )}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                    {isArchived && archivedCount > 0 && (
                        <button
                            onClick={handleDeleteAllArchived}
                            style={{
                                fontSize: '0.8rem',
                                padding: '4px 12px',
                                cursor: 'pointer',
                                background: '#dc2626',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '4px',
                                fontWeight: 600,
                            }}
                        >
                            Delete all archived ({archivedCount})
                        </button>
                    )}
                    <button
                        onClick={() => setViewMode(isArchived ? 'active' : 'archived')}
                        style={{
                            fontSize: '0.8rem',
                            padding: '4px 12px',
                            cursor: 'pointer',
                            background: isArchived ? '#374151' : '#fff',
                            color: isArchived ? '#fff' : '#374151',
                            border: '1px solid #d1d5db',
                            borderRadius: '4px',
                        }}
                    >
                        {isArchived ? 'Show active' : `Show archived (${archivedCount})`}
                    </button>
                </div>
            </div>

            {postings.length === 0 && (
                <div style={{ padding: '24px 0', color: '#6b7280' }}>
                    {isArchived
                        ? 'No archived tracker postings.'
                        : 'No applications tracked yet. Apply to a job from the Resume view to see it here.'}
                </div>
            )}

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                        <th style={{ padding: '8px 10px 8px 0', width: '28px' }}>
                            <input
                                type="checkbox"
                                checked={allPageSelected}
                                ref={(el) => { if (el) el.indeterminate = somePageSelected && !allPageSelected }}
                                onChange={toggleSelectPage}
                                style={{ cursor: 'pointer' }}
                            />
                        </th>
                        {([
                            ['company', 'Company'],
                            ['applied', 'Applied'],
                            ['title', 'Role'],
                            ['seniority', 'Level'],
                            ['location', 'Location'],
                            ['source', 'Source'],
                            ['posted', 'Posted'],
                            ['fit', 'Fit'],
                            ['status', 'Status'],
                        ] as [SortKey, string][]).map(([key, label]) => (
                            <th
                                key={key}
                                onClick={() => handleSort(key)}
                                style={{ padding: '8px 12px 8px 0', fontWeight: 600, color: '#374151', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                            >
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                    {label} {sortArrow(key)}
                                </span>
                            </th>
                        ))}
                        <th style={{ padding: '8px 0', fontWeight: 600, color: '#374151' }}>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {pagePostings.map((posting) => (
                        <tr key={posting.id} data-testid={`tracker-row-${posting.id}`} style={{ borderBottom: '1px solid #f3f4f6', background: selected.has(posting.id) ? '#eff6ff' : undefined, outline: posting.id === lastTouchedId ? '2px solid var(--accent)' : undefined }}>
                            <td style={{ padding: '10px 10px 10px 0' }}>
                                <input
                                    type="checkbox"
                                    checked={selected.has(posting.id)}
                                    onChange={() => toggleSelect(posting.id)}
                                    style={{ cursor: 'pointer' }}
                                />
                            </td>
                            <td style={{ padding: '10px 12px 10px 0', fontWeight: 600 }}>{posting.company}</td>
                            <td style={{ padding: '10px 12px 10px 0', color: '#6b7280', whiteSpace: 'nowrap' }}>
                                {formatDate(posting.applied_at)}
                            </td>
                            <td
                                style={{
                                    padding: '10px 12px 10px 0',
                                    maxWidth: '200px',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                <a
                                    href="#"
                                    onClick={(e) => e.preventDefault()}
                                    style={{ textDecoration: 'none', color: 'inherit' }}
                                    onMouseEnter={(e) => {
                                        const snippet = posting.description_snippet
                                        if (!snippet) return
                                        if (tooltipTimer.current) clearTimeout(tooltipTimer.current)
                                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                                        setTooltip({ x: rect.left, y: rect.bottom + 6, text: snippet })
                                    }}
                                    onMouseLeave={() => {
                                        tooltipTimer.current = setTimeout(() => setTooltip(null), 200)
                                    }}
                                >
                                    {posting.title}
                                </a>
                            </td>
                            <td
                                style={{
                                    padding: '10px 12px 10px 0',
                                    textTransform: 'capitalize',
                                    color: '#374151',
                                }}
                            >
                                {posting.seniority !== 'any' ? posting.seniority : '—'}
                            </td>
                            <td style={{ padding: '10px 12px 10px 0', color: '#6b7280' }}>{posting.location}</td>
                            <td style={{ padding: '10px 12px 10px 0', color: '#6b7280', textTransform: 'capitalize' }}>{posting.source}</td>
                            <td style={{ padding: '10px 12px 10px 0', color: '#6b7280', whiteSpace: 'nowrap' }}>
                                {formatPostedAt(posting.posted_at, posting.fetched_at)}
                            </td>
                            <td style={{ padding: '10px 12px 10px 0' }}>
                                <span data-testid={`tracker-affinity-badge-${posting.id}`}>
                                    <AffinityBadge
                                        score={posting.affinity_score}
                                        hardReqsClass={posting.hard_reqs_class}
                                        niceToHavesClass={posting.nice_to_haves_class}
                                        onClick={posting.hard_reqs_class ? () => { setLastTouchedId(posting.id); setAffinityModal(posting) } : undefined}
                                    />
                                </span>
                            </td>
                            <td style={{ padding: '10px 12px 10px 0' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <select
                                        data-testid={`tracker-status-select-${posting.id}`}
                                        value={posting.status}
                                        onChange={async (e) => {
                                            setLastTouchedId(posting.id)
                                            await handleStatusChange(posting.id, e.target.value as PostingStatus)
                                        }}
                                        style={{ fontSize: '0.78rem', padding: '2px 4px', cursor: 'pointer' }}
                                    >
                                        {STATUS_ORDER.map((s) => (
                                            <option key={s} value={s}>{s}</option>
                                        ))}
                                    </select>
                                    {NEXT_STATUS[posting.status] && (
                                        <button
                                            onClick={async () => {
                                                setLastTouchedId(posting.id)
                                                await handleStatusChange(posting.id, NEXT_STATUS[posting.status]!)
                                            }}
                                            style={{ fontSize: '0.7rem', padding: '2px 6px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                                            title={`Advance to ${NEXT_STATUS[posting.status]}`}
                                        >
                                            → {NEXT_STATUS[posting.status]}
                                        </button>
                                    )}
                                </div>
                            </td>
                            <td
                                style={{
                                    padding: '10px 0',
                                    whiteSpace: 'nowrap',
                                    display: 'flex',
                                    gap: '6px',
                                }}
                            >
                                {isArchived ? (
                                    <>
                                        <button
                                            onClick={() => handleUnarchive(posting.id)}
                                            style={{ fontSize: '0.78rem', padding: '4px 10px', cursor: 'pointer', fontWeight: 600 }}
                                        >
                                            Unarchive
                                        </button>
                                        <button
                                            onClick={() => { setLastTouchedId(posting.id); window.api.openExternal(posting.url).catch(console.error) }}
                                            style={{ fontSize: '0.78rem', padding: '4px 10px', cursor: 'pointer' }}
                                        >
                                            Open ↗
                                        </button>
                                    </>
                                ) : (
                                    <button
                                        data-testid={`tracker-open-btn-${posting.id}`}
                                        onClick={() => { setLastTouchedId(posting.id); handleOpen(posting) }}
                                        style={{ fontSize: '0.78rem', padding: '4px 10px', cursor: 'pointer' }}
                                    >
                                        Open ↗
                                    </button>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <Pagination page={page} totalPages={totalPages} onPage={(p) => { setPage(p); setSelected(new Set()) }} />

            {affinityModal && (
                <AffinityReasonModal posting={affinityModal} onClose={() => setAffinityModal(null)} />
            )}

            <ApplyConfirmModal
                posting={confirmApplyPosting}
                onConfirm={handleConfirmApplied}
                onDecline={handleDeclineApplied}
                onClose={() => setConfirmApplyPosting(null)}
            />

            {tooltip && (
                <div
                    role="tooltip"
                    style={{
                        position: 'fixed',
                        left: tooltip.x,
                        top: tooltip.y,
                        background: '#1f2937',
                        color: '#f9fafb',
                        padding: '6px 10px',
                        borderRadius: '6px',
                        fontSize: '0.8rem',
                        maxWidth: '420px',
                        maxHeight: '300px',
                        overflow: 'hidden',
                        whiteSpace: 'pre-wrap',
                        zIndex: 9999,
                        pointerEvents: 'none',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                    }}
                >
                    {tooltip.text}
                </div>
            )}
        </div>
    )
}
