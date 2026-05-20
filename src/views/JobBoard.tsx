import React, { useState, useEffect, useCallback, useRef } from 'react'
import type { JobPosting } from '../shared/ipc-types'
import { StatusBadge } from '../components/StatusBadge'
import { AffinityBadge } from '../components/AffinityBadge'
import { AffinityReasonModal } from '../components/AffinityReasonModal'
import { ApplyConfirmModal } from '../components/ApplyConfirmModal'
import { Pagination } from '../components/Pagination'

const PAGE_SIZE = 20

type SortKey = 'company' | 'title' | 'seniority' | 'location' | 'source' | 'posted' | 'fit' | 'status'
type SortDir = 'asc' | 'desc'

const SENIORITY_ORDER = ['intern', 'junior', 'mid', 'senior', 'staff', 'any']
const STATUS_ORDER = ['new', 'viewed', 'favorited', 'applied', 'interviewing', 'offer', 'rejected', 'ghosted']

function getComparator(key: SortKey, dir: SortDir): (a: JobPosting, b: JobPosting) => number {
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
        }
    }
}

const NEXT_STATUS: Partial<Record<JobPosting['status'], JobPosting['status']>> = {
    new: 'viewed',
    viewed: 'applied',
    favorited: 'applied',
    applied: 'interviewing',
    interviewing: 'offer',
}

interface JobBoardProps {
    onNavigateToResume: (posting: JobPosting) => void
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

export default function JobBoard({ onNavigateToResume }: JobBoardProps): React.ReactElement {
    const [postings, setPostings] = useState<JobPosting[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [page, setPage] = useState(1)
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [sortKey, setSortKey] = useState<SortKey | null>(null)
    const [sortDir, setSortDir] = useState<SortDir>('asc')
    const [affinityModal, setAffinityModal] = useState<JobPosting | null>(null)
    const [confirmApplyPosting, setConfirmApplyPosting] = useState<JobPosting | null>(null)
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
                    ? window.api.listArchivedPostings()
                    : window.api.getPostings(),
                window.api.getArchivedCount(),
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
        window.api.onScrapingCommitted(() => {
            loadPostings()
        })
        // Live-update events only apply to the active view (newly scraped postings are never archived).
        window.api.onAffinityUpdated((updated) => {
            if (viewMode === 'active') setPostings(updated)
        })
        const unsubPosting = window.api.onPostingCommitted((posting) => {
            if (viewMode === 'active') setPostings((prev) => [posting, ...prev])
        })
        const unsubScored = window.api.onPostingScored((scored) => {
            if (viewMode === 'active') setPostings((prev) => prev.map((p) => p.id === scored.id ? scored : p))
        })
        return () => { unsubPosting(); unsubScored() }
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
        const deleted = await window.api.deleteAllArchived()
        setPostings([])
        setArchivedCount(0)
        setSelected(new Set())
        console.info(`Deleted ${deleted} archived postings`)
    }

    function handleTailorResume(posting: JobPosting): void {
        // Navigate immediately so the Resume view appears without waiting for the IPC round-trip
        onNavigateToResume(posting)
        if (posting.status === 'new') {
            window.api.updatePostingStatus(posting.id, 'viewed').catch(console.error)
        }
    }

    async function handleOpen(posting: JobPosting): Promise<void> {
        if (posting.status === 'new') {
            await window.api.updatePostingStatus(posting.id, 'viewed').catch(console.error)
            setPostings((prev) =>
                prev.map((p) => (p.id === posting.id ? { ...p, status: 'viewed' } : p)),
            )
        }
        await window.api.openExternal(posting.url).catch(console.error)

        const currentStatus: JobPosting['status'] = posting.status === 'new' ? 'viewed' : posting.status
        const promptable: JobPosting['status'][] = ['viewed', 'favorited']
        if (promptable.includes(currentStatus)) {
            setConfirmApplyPosting({ ...posting, status: currentStatus })
        }
    }

    async function handleConfirmApplied(): Promise<void> {
        const p = confirmApplyPosting
        if (!p) return
        setConfirmApplyPosting(null)
        await window.api.updatePostingStatus(p.id, 'applied').catch(console.error)
        setPostings((prev) => prev.map((x) => (x.id === p.id ? { ...x, status: 'applied' } : x)))
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

    if (loading) return <div style={{ padding: '24px', color: '#6b7280' }}>Loading postings…</div>
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
                    {isArchived ? 'Archived Jobs' : 'Jobs'}{' '}
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
                        ? 'No archived postings.'
                        : 'No postings yet. Run a scrape from Search Config to populate the board.'}
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
                        <tr key={posting.id} data-testid={`job-row-${posting.id}`} style={{ borderBottom: '1px solid #f3f4f6', background: selected.has(posting.id) ? '#eff6ff' : undefined, outline: posting.id === lastTouchedId ? '2px solid var(--accent)' : undefined }}>
                            <td style={{ padding: '10px 10px 10px 0' }}>
                                <input
                                    type="checkbox"
                                    checked={selected.has(posting.id)}
                                    onChange={() => toggleSelect(posting.id)}
                                    style={{ cursor: 'pointer' }}
                                />
                            </td>
                            <td style={{ padding: '10px 12px 10px 0', fontWeight: 600 }}>{posting.company}</td>
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
                                        if (!posting.raw_text) return
                                        if (tooltipTimer.current) clearTimeout(tooltipTimer.current)
                                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                                        const snippet = posting.raw_text.length > 600
                                            ? posting.raw_text.slice(0, 600) + '…'
                                            : posting.raw_text
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
                                <span data-testid={`job-affinity-badge-${posting.id}`}>
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
                                        value={posting.status}
                                        onChange={async (e) => {
                                            setLastTouchedId(posting.id)
                                            const newStatus = e.target.value as JobPosting['status']
                                            await window.api.updatePostingStatus(posting.id, newStatus).catch(console.error)
                                            setPostings((prev) =>
                                                prev.map((p) => (p.id === posting.id ? { ...p, status: newStatus } : p)),
                                            )
                                        }}
                                        style={{ fontSize: '0.78rem', padding: '2px 4px', cursor: 'pointer' }}
                                    >
                                        {(['new', 'viewed', 'favorited', 'applied', 'interviewing', 'offer', 'rejected', 'ghosted'] as JobPosting['status'][]).map((s) => (
                                            <option key={s} value={s}>{s}</option>
                                        ))}
                                    </select>
                                    {NEXT_STATUS[posting.status] && (
                                        <button
                                            onClick={async () => {
                                                setLastTouchedId(posting.id)
                                                const next = NEXT_STATUS[posting.status]!
                                                await window.api.updatePostingStatus(posting.id, next).catch(console.error)
                                                setPostings((prev) =>
                                                    prev.map((p) => (p.id === posting.id ? { ...p, status: next } : p)),
                                                )
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
                                    <>
                                        <button
                                            data-testid={`job-tailor-btn-${posting.id}`}
                                            onClick={() => { setLastTouchedId(posting.id); handleTailorResume(posting) }}
                                            style={{ fontSize: '0.78rem', padding: '4px 10px', cursor: 'pointer', fontWeight: 600 }}
                                        >
                                            Tailor Resume
                                        </button>
                                        <button
                                            data-testid={`job-open-btn-${posting.id}`}
                                            onClick={() => { setLastTouchedId(posting.id); handleOpen(posting) }}
                                            style={{ fontSize: '0.78rem', padding: '4px 10px', cursor: 'pointer' }}
                                        >
                                            Open ↗
                                        </button>
                                    </>
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
