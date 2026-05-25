import React, { useState } from 'react'
import type { ProfileEntry, LanguageItem, CitizenshipItem } from '../../shared/ipc-types'
import {
    ENTRY_TYPES, TYPE_LABELS, TYPE_COLORS,
    INDUSTRIES, LANGUAGES, LANGUAGE_PROFICIENCIES, COUNTRIES, CITIZENSHIP_STATUSES,
} from './constants'
import type { FilterType } from './constants'

interface EntryListProps {
    entries: ProfileEntry[]
    filter: FilterType
    statusMsg: string | null
    yoeInput: string
    yoeComputed: number
    yoeOverridden: boolean
    qualsIndustries: string[]
    qualsLanguages: LanguageItem[]
    qualsCitizenship: CitizenshipItem[]
    qualsDriversLicense: boolean
    pdfImporting: boolean
    extracting: boolean
    setFilter: (f: FilterType) => void
    setYoeInput: (v: string) => void
    setQualsDriversLicense: (v: boolean) => void
    onAddIndustry: (industry: string) => void
    onRemoveIndustry: (index: number) => void
    onAddLanguage: (item: LanguageItem) => void
    onRemoveLanguage: (index: number) => void
    onAddCitizenship: (item: CitizenshipItem) => void
    onRemoveCitizenship: (index: number) => void
    onSaveYoe: () => void
    onResetYoe: () => void
    onSaveQualifications: () => void
    onExtractQualifications: () => void
    onAdd: () => void
    onEdit: (entry: ProfileEntry) => void
    onDelete: (id: string) => void
    onExport: () => void
    onImport: () => void
    onImportPdf: () => void
}

const sectionLabel: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--text-dim, #6b7280)',
    marginBottom: 8,
    marginTop: 20,
}

const itemRow: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 0',
    borderBottom: '1px solid var(--border, #e5e7eb)',
}

const itemLabel: React.CSSProperties = {
    flex: 1,
    fontSize: 14,
}

const removeBtn: React.CSSProperties = {
    fontSize: 12,
    padding: '2px 8px',
    background: 'none',
    border: '1px solid var(--border, #e5e7eb)',
    borderRadius: 4,
    cursor: 'pointer',
    color: 'var(--text-dim, #6b7280)',
    flexShrink: 0,
}

function GeneralSection({
    qualsIndustries,
    qualsLanguages,
    qualsCitizenship,
    qualsDriversLicense,
    extracting,
    setQualsDriversLicense,
    onAddIndustry,
    onRemoveIndustry,
    onAddLanguage,
    onRemoveLanguage,
    onAddCitizenship,
    onRemoveCitizenship,
    onSaveQualifications,
    onExtractQualifications,
}: Pick<
    EntryListProps,
    'qualsIndustries' | 'qualsLanguages' | 'qualsCitizenship' | 'qualsDriversLicense' |
    'extracting' | 'setQualsDriversLicense' | 'onAddIndustry' | 'onRemoveIndustry' |
    'onAddLanguage' | 'onRemoveLanguage' | 'onAddCitizenship' | 'onRemoveCitizenship' |
    'onSaveQualifications' | 'onExtractQualifications'
>): React.ReactElement {
    const [industryToAdd, setIndustryToAdd] = useState(INDUSTRIES[0])
    const [langToAdd, setLangToAdd] = useState(LANGUAGES[0])
    const [langProfToAdd, setLangProfToAdd] = useState(LANGUAGE_PROFICIENCIES[0])
    const [countryToAdd, setCountryToAdd] = useState(COUNTRIES[0])
    const [statusToAdd, setStatusToAdd] = useState(CITIZENSHIP_STATUSES[0])

    function addIndustry(): void {
        onAddIndustry(industryToAdd)
    }

    function addLanguage(): void {
        onAddLanguage({ name: langToAdd, proficiency: langProfToAdd })
    }

    function addCitizenship(): void {
        onAddCitizenship({ country: countryToAdd, status: statusToAdd })
    }

    const addRowStyle: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }

    return (
        <div className="card" data-testid="quals-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div style={{ fontWeight: 600 }}>General</div>
                <button
                    data-testid="quals-extract"
                    className="btn"
                    onClick={onExtractQualifications}
                    disabled={extracting}
                    title="Use AI to populate these fields from your profile entries"
                >
                    {extracting ? 'Extracting…' : 'Extract from profile'}
                </button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-dim, #6b7280)', marginBottom: 16 }}>
                Authoritative facts fed directly to the job evaluator. Extract auto-fills from your entries — review then Save.
            </div>

            {/* Industries */}
            <div style={sectionLabel}>Industries</div>
            {qualsIndustries.map((ind, i) => (
                <div key={i} style={itemRow} data-testid="quals-industry-item">
                    <span style={itemLabel}>{ind}</span>
                    <button style={removeBtn} onClick={() => onRemoveIndustry(i)}>Remove</button>
                </div>
            ))}
            <div style={addRowStyle}>
                <select
                    data-testid="quals-industry-select"
                    value={industryToAdd}
                    onChange={(e) => setIndustryToAdd(e.target.value)}
                    style={{ flex: 1 }}
                >
                    {INDUSTRIES.map((ind) => <option key={ind} value={ind}>{ind}</option>)}
                </select>
                <button data-testid="quals-industry-add" className="btn btn-primary" onClick={addIndustry}>Add</button>
            </div>

            {/* Languages */}
            <div style={sectionLabel}>Languages</div>
            {qualsLanguages.map((lang, i) => (
                <div key={i} style={itemRow} data-testid="quals-language-item">
                    <span style={itemLabel}>{lang.name} — {lang.proficiency}</span>
                    <button style={removeBtn} onClick={() => onRemoveLanguage(i)}>Remove</button>
                </div>
            ))}
            <div style={addRowStyle}>
                <select
                    data-testid="quals-language-select"
                    value={langToAdd}
                    onChange={(e) => setLangToAdd(e.target.value)}
                    style={{ flex: 2 }}
                >
                    {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
                <select
                    data-testid="quals-language-proficiency"
                    value={langProfToAdd}
                    onChange={(e) => setLangProfToAdd(e.target.value)}
                    style={{ flex: 2 }}
                >
                    {LANGUAGE_PROFICIENCIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <button data-testid="quals-language-add" className="btn btn-primary" onClick={addLanguage}>Add</button>
            </div>

            {/* Citizenship */}
            <div style={sectionLabel}>Citizenship / Work Authorization</div>
            {qualsCitizenship.map((c, i) => (
                <div key={i} style={itemRow} data-testid="quals-citizenship-item">
                    <span style={itemLabel}>{c.country} — {c.status}</span>
                    <button style={removeBtn} onClick={() => onRemoveCitizenship(i)}>Remove</button>
                </div>
            ))}
            <div style={addRowStyle}>
                <select
                    data-testid="quals-citizenship-country"
                    value={countryToAdd}
                    onChange={(e) => setCountryToAdd(e.target.value)}
                    style={{ flex: 2 }}
                >
                    {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select
                    data-testid="quals-citizenship-status"
                    value={statusToAdd}
                    onChange={(e) => setStatusToAdd(e.target.value)}
                    style={{ flex: 2 }}
                >
                    {CITIZENSHIP_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <button data-testid="quals-citizenship-add" className="btn btn-primary" onClick={addCitizenship}>Add</button>
            </div>

            {/* Other */}
            <div style={sectionLabel}>Other</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
                <input
                    data-testid="quals-drivers-license"
                    type="checkbox"
                    checked={qualsDriversLicense}
                    onChange={(e) => setQualsDriversLicense(e.target.checked)}
                />
                Has driver&apos;s licence
            </label>

            <div style={{ marginTop: 20 }}>
                <button data-testid="quals-save" className="btn btn-primary" onClick={onSaveQualifications}>Save General</button>
            </div>
        </div>
    )
}

export function EntryList({
    entries,
    filter,
    statusMsg,
    yoeInput,
    yoeComputed,
    yoeOverridden,
    qualsIndustries,
    qualsLanguages,
    qualsCitizenship,
    qualsDriversLicense,
    pdfImporting,
    extracting,
    setFilter,
    setYoeInput,
    setQualsDriversLicense,
    onAddIndustry,
    onRemoveIndustry,
    onAddLanguage,
    onRemoveLanguage,
    onAddCitizenship,
    onRemoveCitizenship,
    onSaveYoe,
    onResetYoe,
    onSaveQualifications,
    onExtractQualifications,
    onAdd,
    onEdit,
    onDelete,
    onExport,
    onImport,
    onImportPdf,
}: EntryListProps): React.ReactElement {
    const filtered = (filter === 'all' || filter === 'general')
        ? entries
        : entries.filter((e) => e.type === filter)

    return (
        <div>
            <h1>Profile</h1>

            {/* YOE input + data management row */}
            <div className="card">
                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div style={{ flex: '1 1 240px' }}>
                        <div className="form-row" style={{ marginBottom: 0 }}>
                            <label htmlFor="profile-yoe">Years of experience</label>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <input
                                    id="profile-yoe"
                                    data-testid="profile-yoe-input"
                                    type="number"
                                    min={0}
                                    max={60}
                                    step={0.1}
                                    value={yoeInput}
                                    onChange={(e) => setYoeInput(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') onSaveYoe() }}
                                    style={{ width: 90 }}
                                />
                                <button data-testid="profile-yoe-save" className="btn btn-primary" onClick={onSaveYoe}>Save</button>
                                {yoeOverridden && (
                                    <button
                                        data-testid="profile-yoe-reset"
                                        className="btn"
                                        onClick={onResetYoe}
                                        title={`Use computed value (${yoeComputed.toFixed(1)})`}
                                    >
                                        Reset to {yoeComputed.toFixed(1)}
                                    </button>
                                )}
                            </div>
                            <div className="form-hint">
                                {yoeOverridden
                                    ? `Override active. Computed from entries: ${yoeComputed.toFixed(1)} years.`
                                    : `Computed from Experience entries. Edit this field to override.`}
                            </div>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, paddingBottom: 20 }}>
                        <button className="btn" onClick={onExport}>Export Markdown</button>
                        <button className="btn" onClick={onImport}>Import Markdown</button>
                        <button
                            data-testid="profile-import-pdf-btn"
                            className="btn"
                            onClick={onImportPdf}
                            disabled={pdfImporting}
                            title="Upload a resume PDF and let AI populate your profile"
                        >
                            {pdfImporting ? 'Importing…' : 'Import from Resume PDF'}
                        </button>
                    </div>
                </div>
                {statusMsg && (
                    <div style={{ marginTop: 4, fontSize: 13, color: 'var(--text-dim, #6b7280)' }}>
                        {statusMsg}
                    </div>
                )}
            </div>

            {/* Filter tabs + Add button */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                {(['all', 'general', ...ENTRY_TYPES] as FilterType[]).map((t) => {
                    const count = t === 'all' ? entries.length
                        : t === 'general' ? null
                        : entries.filter((e) => e.type === t).length
                    return (
                        <button
                            key={t}
                            className={`btn${filter === t ? ' btn-primary' : ''}`}
                            onClick={() => setFilter(t)}
                        >
                            {t === 'all' ? 'All' : t === 'general' ? 'General' : TYPE_LABELS[t]}
                            {count !== null ? ` (${count})` : ''}
                        </button>
                    )
                })}
                {filter !== 'general' && (
                    <button
                        data-testid="profile-add-btn"
                        className="btn btn-primary"
                        onClick={onAdd}
                        style={{ marginLeft: 'auto' }}
                    >
                        + Add Entry
                    </button>
                )}
            </div>

            {/* General tab content */}
            {filter === 'general' && (
                <GeneralSection
                    qualsIndustries={qualsIndustries}
                    qualsLanguages={qualsLanguages}
                    qualsCitizenship={qualsCitizenship}
                    qualsDriversLicense={qualsDriversLicense}
                    extracting={extracting}
                    setQualsDriversLicense={setQualsDriversLicense}
                    onAddIndustry={onAddIndustry}
                    onRemoveIndustry={onRemoveIndustry}
                    onAddLanguage={onAddLanguage}
                    onRemoveLanguage={onRemoveLanguage}
                    onAddCitizenship={onAddCitizenship}
                    onRemoveCitizenship={onRemoveCitizenship}
                    onSaveQualifications={onSaveQualifications}
                    onExtractQualifications={onExtractQualifications}
                />
            )}

            {/* Entry list (hidden on General tab) */}
            {filter !== 'general' && (
                filtered.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-dim, #6b7280)' }}>
                        No entries yet.{' '}
                        <button className="btn btn-primary" onClick={onAdd}>Add one</button>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {filtered.map((entry) => (
                            <div key={entry.id} data-testid={`profile-entry-${entry.id}`} className="card" style={{ margin: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                                    {/* Type badge */}
                                    <span style={{
                                        fontSize: 11,
                                        fontWeight: 600,
                                        padding: '2px 8px',
                                        borderRadius: 4,
                                        background: TYPE_COLORS[entry.type],
                                        color: '#fff',
                                        flexShrink: 0,
                                        marginTop: 2,
                                        whiteSpace: 'nowrap',
                                    }}>
                                        {TYPE_LABELS[entry.type]}
                                    </span>

                                    {/* Content */}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 600, fontSize: 14, cursor: 'pointer' }} onClick={() => onEdit(entry)}>{entry.title}</div>

                                        {(entry.start_date || entry.end_date) && (
                                            <div style={{ fontSize: 12, color: 'var(--text-dim, #6b7280)', marginTop: 2 }}>
                                                {entry.start_date ?? '?'} → {entry.end_date ?? 'present'}
                                            </div>
                                        )}

                                        <div style={{
                                            fontSize: 13,
                                            color: 'var(--text-dim, #6b7280)',
                                            marginTop: 4,
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                        }}>
                                            {entry.content.slice(0, 130)}{entry.content.length > 130 ? '…' : ''}
                                        </div>

                                        {entry.tags.length > 0 && (
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                                                {entry.tags.map((tag) => (
                                                    <span key={tag} style={{
                                                        fontSize: 11,
                                                        padding: '1px 6px',
                                                        borderRadius: 3,
                                                        background: 'var(--surface-2, #f3f4f6)',
                                                        color: 'var(--text-dim, #6b7280)',
                                                    }}>
                                                        {tag}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    {/* Actions */}
                                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                        <button
                                            data-testid={`profile-entry-edit-${entry.id}`}
                                            className="btn"
                                            style={{ fontSize: 12, padding: '3px 10px' }}
                                            onClick={() => onEdit(entry)}
                                        >
                                            Edit
                                        </button>
                                        <button
                                            data-testid={`profile-entry-delete-${entry.id}`}
                                            className="btn btn-danger"
                                            style={{ fontSize: 12, padding: '3px 10px' }}
                                            onClick={() => onDelete(entry.id)}
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )
            )}
        </div>
    )
}
