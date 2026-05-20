import React, { useState, useEffect } from 'react'
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts'
import type {
    FunnelSummary,
    SourceMetric,
    SeniorityMetric,
    WeeklyMetric,
    LLMCostSummary,
    LLMCostByType,
} from '../shared/ipc-types'

function StatCard({
    label,
    value,
    sub,
}: {
    label: string
    value: string | number
    sub?: string
}): React.ReactElement {
    return (
        <div
            style={{
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                padding: '16px 20px',
                minWidth: '130px',
                flex: '1 1 130px',
            }}
        >
            <div style={{ fontSize: '0.78rem', color: '#6b7280', marginBottom: '4px' }}>{label}</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, lineHeight: 1 }}>{value}</div>
            {sub && <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: '4px' }}>{sub}</div>}
        </div>
    )
}

function SectionHeader({ title }: { title: string }): React.ReactElement {
    return (
        <h3
            style={{
                margin: '28px 0 12px',
                fontSize: '0.95rem',
                fontWeight: 700,
                color: '#374151',
                borderBottom: '1px solid #e5e7eb',
                paddingBottom: '6px',
            }}
        >
            {title}
        </h3>
    )
}

export default function Analytics(): React.ReactElement {
    const [funnel, setFunnel] = useState<FunnelSummary | null>(null)
    const [bySource, setBySource] = useState<SourceMetric[]>([])
    const [bySeniority, setBySeniority] = useState<SeniorityMetric[]>([])
    const [weekly, setWeekly] = useState<WeeklyMetric[]>([])
    const [llmCost, setLlmCost] = useState<LLMCostSummary | null>(null)
    const [llmByType, setLlmByType] = useState<LLMCostByType[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        Promise.all([
            window.api.getAnalyticsFunnel(),
            window.api.getAnalyticsBySource(),
            window.api.getAnalyticsBySeniority(),
            window.api.getAnalyticsWeekly(),
            window.api.getAnalyticsLLMCost(),
            window.api.getAnalyticsLLMCostByType(),
        ])
            .then(([f, src, sen, wk, cost, costByType]) => {
                setFunnel(f)
                setBySource(src)
                setBySeniority(sen)
                setWeekly(wk)
                setLlmCost(cost)
                setLlmByType(costByType)
            })
            .catch((err) => setError(err instanceof Error ? err.message : String(err)))
            .finally(() => setLoading(false))
    }, [])

    if (loading) return <div style={{ padding: '24px', color: '#6b7280' }}>Loading analytics…</div>
    if (error) return <div style={{ padding: '24px', color: 'crimson' }}>Error: {error}</div>

    function pct(n: number | null | undefined): string {
        if (n === null || n === undefined) return '—'
        return `${Math.round(n * 100)}%`
    }

    function usd(n: number | null | undefined): string {
        if (n === null || n === undefined) return '$0.00'
        return `$${n.toFixed(4)}`
    }

    return (
        <div
            style={{
                padding: '24px',
                overflowY: 'auto',
                height: '100%',
                boxSizing: 'border-box',
                maxWidth: '800px',
            }}
        >
            <h2 style={{ marginTop: 0 }}>Analytics</h2>

            {funnel && (
                <div data-testid="analytics-funnel" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <StatCard label="Applications" value={funnel.applied} />
                    <StatCard label="Interviewing" value={funnel.interviewing} />
                    <StatCard label="Offers" value={funnel.offer} />
                    <StatCard label="Rejected" value={funnel.rejected} />
                    <StatCard label="Response Rate" value={pct(funnel.response_rate)} sub="of applications" />
                    <StatCard label="Conversion rate" value={pct(funnel.conversion_rate)} sub="apply → offer" />
                </div>
            )}

            <SectionHeader title="Applications per Week (last 12 weeks)" />
            <ResponsiveContainer data-testid="analytics-weekly-chart" width="100%" height={220}>
                <BarChart data={weekly} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="applications" fill="#2563eb" radius={[3, 3, 0, 0]} />
                </BarChart>
            </ResponsiveContainer>

            <SectionHeader title="By Source" />
            {bySource.length === 0 ? (
                <p style={{ fontSize: '0.85rem', color: '#6b7280' }}>No source data yet.</p>
            ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                    <thead>
                        <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                            <th style={{ padding: '6px 12px 6px 0', fontWeight: 600, color: '#374151' }}>Source</th>
                            <th style={{ padding: '6px 12px 6px 0', fontWeight: 600, color: '#374151' }}>Applications</th>
                            <th style={{ padding: '6px 12px 6px 0', fontWeight: 600, color: '#374151' }}>Response Rate</th>
                            <th style={{ padding: '6px 0', fontWeight: 600, color: '#374151' }}>Avg Days to Response</th>
                        </tr>
                    </thead>
                    <tbody>
                        {bySource.map((s) => (
                            <tr key={s.source} style={{ borderBottom: '1px solid #f3f4f6' }}>
                                <td style={{ padding: '8px 12px 8px 0', textTransform: 'capitalize' }}>{s.source}</td>
                                <td style={{ padding: '8px 12px 8px 0' }}>{s.count}</td>
                                <td style={{ padding: '8px 12px 8px 0' }}>{pct(s.response_rate)}</td>
                                <td style={{ padding: '8px 0', color: '#6b7280' }}>
                                    {s.avg_days_to_response !== null ? `${Math.round(s.avg_days_to_response)}d` : '—'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}

            <SectionHeader title="By Seniority" />
            {bySeniority.length === 0 ? (
                <p style={{ fontSize: '0.85rem', color: '#6b7280' }}>No seniority data yet.</p>
            ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                    <thead>
                        <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                            <th style={{ padding: '6px 12px 6px 0', fontWeight: 600, color: '#374151' }}>Level</th>
                            <th style={{ padding: '6px 12px 6px 0', fontWeight: 600, color: '#374151' }}>Postings</th>
                            <th style={{ padding: '6px 0', fontWeight: 600, color: '#374151' }}>Response Rate</th>
                        </tr>
                    </thead>
                    <tbody>
                        {bySeniority.map((s) => (
                            <tr key={s.seniority} style={{ borderBottom: '1px solid #f3f4f6' }}>
                                <td style={{ padding: '8px 12px 8px 0', textTransform: 'capitalize' }}>{s.seniority}</td>
                                <td style={{ padding: '8px 12px 8px 0' }}>{s.count}</td>
                                <td style={{ padding: '8px 0' }}>{pct(s.response_rate)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}

            <SectionHeader title="LLM Cost & Usage" />
            {llmCost && (
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
                    <StatCard label="All-time cost" value={usd(llmCost.all_time)} />
                </div>
            )}
            {llmByType.length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                    <thead>
                        <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                            <th style={{ padding: '6px 12px 6px 0', fontWeight: 600, color: '#374151' }}>Type</th>
                            <th style={{ padding: '6px 12px 6px 0', fontWeight: 600, color: '#374151' }}>Calls</th>
                            <th style={{ padding: '6px 0', fontWeight: 600, color: '#374151' }}>Cost</th>
                        </tr>
                    </thead>
                    <tbody>
                        {llmByType.map((t) => (
                            <tr key={t.call_type} style={{ borderBottom: '1px solid #f3f4f6' }}>
                                <td
                                    style={{ padding: '8px 12px 8px 0', fontFamily: 'monospace', fontSize: '0.8rem' }}
                                >
                                    {t.call_type}
                                </td>
                                <td style={{ padding: '8px 12px 8px 0' }}>{t.call_count}</td>
                                <td style={{ padding: '8px 0' }}>{usd(t.total_cost)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    )
}

