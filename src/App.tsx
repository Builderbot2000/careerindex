import React, { useState, useEffect } from 'react'
import type { FeatureLocks, JobPosting, AdapterProgress, CaptchaRequest, LoginRequest, UpdateStatus } from './shared/ipc-types'
import Settings from './views/Settings'
import Profile from './views/Profile'
import SearchConfig from './views/SearchConfig'
import JobBoard from './views/JobBoard'
import ResumePreview from './views/ResumePreview'
import Tracker from './views/Tracker'
import Analytics from './views/Analytics'
import { ChromiumInstallModal } from './components/ChromiumInstallModal'
import { ResumeLockedModal } from './components/ResumeLockedModal'
import { ClaudeQuotaLockedModal } from './components/ClaudeQuotaLockedModal'
import { UpdateModal } from './components/UpdateModal'

export type ScrapeState = 'idle' | 'running' | 'paused' | 'error'

export type View = 'profile' | 'search' | 'jobs' | 'resume' | 'tracker' | 'analytics' | 'settings'

interface NavItem {
    id: View
    label: string
    lockedBy?: (keyof FeatureLocks)[]
}

const NAV: NavItem[] = [
    { id: 'profile', label: 'Profile' },
    { id: 'search', label: 'Search', lockedBy: ['playwrightChromium', 'claudeQuotaLock'] },
    { id: 'jobs', label: 'Jobs', lockedBy: ['claudeQuotaLock'] },
    { id: 'resume', label: 'Resume', lockedBy: ['typst', 'claudeApiKey', 'profileEmpty', 'claudeQuotaLock'] },
    { id: 'tracker', label: 'Tracker' },
    { id: 'analytics', label: 'Analytics' },
    { id: 'settings', label: 'Settings' },
]

export default function App(): React.ReactElement {
    const [view, setView] = useState<View>('settings')
    const [featureLocks, setFeatureLocks] = useState<FeatureLocks>({
        claudeApiKey: false,
        claudeConnectivity: false,
        claudeQuotaLock: null,
        typst: false,
        playwrightChromium: false,
        profileEmpty: false,
    })
    const [pendingNavPosting, setPendingNavPosting] = useState<JobPosting | null>(null)
    const [searchNavKey, setSearchNavKey] = useState(0)
    const [scrapeState, setScrapeState] = useState<ScrapeState>('idle')
    const [adapterProgress, setAdapterProgress] = useState<Record<string, AdapterProgress>>({})
    const [scrapeError, setScrapeError] = useState<string | null>(null)
    const [captchaQueue, setCaptchaQueue] = useState<CaptchaRequest[]>([])
    const [loginQueue, setLoginQueue] = useState<LoginRequest[]>([])
    const [lockedNav, setLockedNav] = useState<View | null>(null)
    const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: 'idle' })
    const [updateModalOpen, setUpdateModalOpen] = useState(false)

    useEffect(() => {
        window.api.onFeatureLocks((locks) => setFeatureLocks(locks))
        window.api.onAdapterProgress((p) => {
            setAdapterProgress((prev) => ({ ...prev, [p.adapterId]: p }))
        })
        window.api.onCaptchaRequired((req) => {
            setCaptchaQueue((q) => [...q, req])
        })
        window.api.onLoginRequired((req) => {
            setLoginQueue((q) => [...q, req])
        })
        window.api.onUpdateStatus((status) => {
            setUpdateStatus(status)
            // Auto-open the modal when something actionable happens (an update was
            // found or finished downloading). Stay quiet on background "checking"
            // and "not-available" so the silent launch check doesn't interrupt.
            if (status.state === 'available' || status.state === 'downloaded') {
                setUpdateModalOpen(true)
            }
        })
        window.api.getUpdateStatus().then((s) => setUpdateStatus(s)).catch(() => undefined)
    }, [])

    function handleManualUpdateCheck(): void {
        setUpdateModalOpen(true)
        window.api.checkForUpdates().catch(console.error)
    }

    async function runScrape(adapterIds: string[], loginAdapterIds: string[]): Promise<void> {
        setScrapeState('running')
        setScrapeError(null)
        setAdapterProgress({})
        try {
            await window.api.runScrape(adapterIds, loginAdapterIds)
            setScrapeState('idle')
        } catch (err) {
            setScrapeError(err instanceof Error ? err.message : String(err))
            setScrapeState('error')
        }
    }

    async function pauseScrape(): Promise<void> {
        await window.api.pauseScrape()
        setScrapeState('paused')
    }

    async function resumeScrape(): Promise<void> {
        await window.api.resumeScrape()
        setScrapeState('running')
    }

    async function abortScrape(): Promise<void> {
        await window.api.abortScrape()
        setScrapeState('idle')
    }

    async function resolveCaptcha(adapterId: string): Promise<void> {
        await window.api.resolveCaptcha(adapterId)
        setCaptchaQueue((q) => q.filter((r) => r.adapterId !== adapterId))
    }

    async function resolveLogin(adapterId: string): Promise<void> {
        await window.api.resolveLogin(adapterId)
        setLoginQueue((q) => q.filter((r) => r.adapterId !== adapterId))
    }

    function isLocked(item: NavItem): boolean {
        if (!item.lockedBy) return false
        return item.lockedBy.some((k) => Boolean(featureLocks[k]))
    }

    function navigate(id: View, posting?: JobPosting): void {
        const item = NAV.find((n) => n.id === id)
        if (item && isLocked(item)) {
            setLockedNav(id)
            return
        }
        setPendingNavPosting(posting ?? null)
        if (id === 'search') setSearchNavKey((k) => k + 1)
        setView(id)
    }

    return (
        <div className="app-shell">
            <nav className="sidebar">
                <div className="sidebar-title">CareerIndex</div>
                <button
                    type="button"
                    className="sidebar-update-btn"
                    onClick={handleManualUpdateCheck}
                    title="Check for updates"
                >
                    Check for updates
                    {(updateStatus.state === 'available' || updateStatus.state === 'downloaded') && (
                        <span className="pending-badge" title="Update ready" />
                    )}
                </button>
                {NAV.map((item) => {
                    const locked = isLocked(item)
                    return (
                        <button
                            key={item.id}
                            data-testid={`nav-${item.id}`}
                            className={`nav-btn${view === item.id ? ' active' : ''}${locked ? ' locked' : ''}`}
                            onClick={() => navigate(item.id)}
                            title={locked ? 'Feature locked — check Settings' : item.label}
                        >
                            {item.label}
                            {locked && <span className="lock-badge">locked</span>}
                            {item.id === 'search' && (scrapeState === 'running' || scrapeState === 'paused') && (
                                <span className="pending-badge" title="Scrape results ready to commit" />
                            )}
                        </button>
                    )
                })}
            </nav>

            <main className="content">
                {view === 'profile' && <Profile />}
                {view === 'search' && (
                    <SearchConfig
                        key={searchNavKey}
                        scrapeState={scrapeState}
                        adapterProgress={adapterProgress}
                        errorMsg={scrapeError}
                        captchaQueue={captchaQueue}
                        loginQueue={loginQueue}
                        onRunScrape={(ids, loginIds) => { runScrape(ids, loginIds).catch(console.error) }}
                        onPause={() => { pauseScrape().catch(console.error) }}
                        onResume={() => { resumeScrape().catch(console.error) }}
                        onAbort={() => { abortScrape().catch(console.error) }}
                        onResolveCaptcha={(id) => { resolveCaptcha(id).catch(console.error) }}
                        onResolveLogin={(id) => { resolveLogin(id).catch(console.error) }}
                    />
                )}
                {view === 'jobs' && <JobBoard onNavigateToResume={(posting) => {
                    setPendingNavPosting(posting)
                    setView('resume')
                }} />}
                {view === 'resume' && <ResumePreview initialPosting={pendingNavPosting} />}
                {view === 'tracker' && <Tracker />}
                {view === 'analytics' && <Analytics />}
                {view === 'settings' && <Settings featureLocks={featureLocks} />}
            </main>
            {lockedNav !== null && featureLocks.claudeQuotaLock && (
                <ClaudeQuotaLockedModal
                    lock={featureLocks.claudeQuotaLock}
                    onClose={() => setLockedNav(null)}
                    onNavigate={(v) => { setLockedNav(null); navigate(v) }}
                />
            )}
            {lockedNav === 'search' && !featureLocks.claudeQuotaLock && (
                <ChromiumInstallModal
                    onClose={() => setLockedNav(null)}
                    onInstalled={() => { setLockedNav(null); setView('search') }}
                />
            )}
            {lockedNav === 'resume' && !featureLocks.claudeQuotaLock && (
                <ResumeLockedModal
                    featureLocks={featureLocks}
                    onClose={() => setLockedNav(null)}
                    onNavigate={(v) => { setLockedNav(null); navigate(v) }}
                />
            )}
            {updateModalOpen && (
                <UpdateModal
                    status={updateStatus}
                    onClose={() => setUpdateModalOpen(false)}
                    onCheckAgain={() => window.api.checkForUpdates().catch(console.error)}
                    onDownload={() => window.api.downloadUpdate().catch(console.error)}
                    onRestart={() => window.api.quitAndInstallUpdate().catch(console.error)}
                />
            )}
        </div>
    )
}
