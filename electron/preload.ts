import { contextBridge, ipcRenderer } from 'electron'
import type {
  Settings,
  FeatureLocks,
  SettingKey,
  ElectronAPI,
  CreateProfileEntryInput,
  UpdateProfileEntryInput,
  PostingStatus,
  SearchConfigRow,
  SearchTerm,
  AddSearchTermData,
  GenConstraints,
  BanListEntry,
  JobPosting,
  AdapterProgress,
  CaptchaRequest,
  LoginRequest,
  ProfileEntry,
  WorkType,
  SearchTermSeniority,
  Recency,
  UpdateStatus,
} from '../src/shared/ipc-types'

contextBridge.exposeInMainWorld('api', {
  // ── Startup ────────────────────────────────────────────────────────────────
  onFeatureLocks(cb: (locks: FeatureLocks) => void): void {
    ipcRenderer.on('startup:feature-locks', (_event, locks: FeatureLocks) => cb(locks))
  },

  refreshFeatureLocks(): Promise<void> {
    return ipcRenderer.invoke('startup:refresh-locks')
  },

  clearClaudeQuotaLock(): Promise<void> {
    return ipcRenderer.invoke('startup:clear-claude-quota-lock')
  },

  // ── Updates ────────────────────────────────────────────────────────────────
  checkForUpdates(): Promise<void> {
    return ipcRenderer.invoke('updates:check')
  },

  downloadUpdate(): Promise<void> {
    return ipcRenderer.invoke('updates:download')
  },

  quitAndInstallUpdate(): Promise<void> {
    return ipcRenderer.invoke('updates:quit-and-install')
  },

  getUpdateStatus(): Promise<UpdateStatus> {
    return ipcRenderer.invoke('updates:get-status')
  },

  onUpdateStatus(cb: (status: UpdateStatus) => void): void {
    ipcRenderer.on('updates:status', (_event, status: UpdateStatus) => cb(status))
  },

  // ── Settings ───────────────────────────────────────────────────────────────
  getSettings(): Promise<Settings> {
    return ipcRenderer.invoke('settings:get')
  },

  updateSetting(key: SettingKey, value: Settings[SettingKey]): Promise<void> {
    return ipcRenderer.invoke('settings:update', { key, value })
  },

  getApiKeyPresent(): Promise<boolean> {
    return ipcRenderer.invoke('settings:api-key-present')
  },

  setApiKey(key: string): Promise<void> {
    return ipcRenderer.invoke('settings:set-api-key', key)
  },

  deleteApiKey(): Promise<void> {
    return ipcRenderer.invoke('settings:delete-api-key')
  },

  // ── Shell ──────────────────────────────────────────────────────────────────
  openExternal(url: string): Promise<void> {
    return ipcRenderer.invoke('shell:open-external', url)
  },

  // ── Profile ────────────────────────────────────────────────────────────────
  getProfileEntries() {
    return ipcRenderer.invoke('profile:get-all')
  },

  createProfileEntry(input: CreateProfileEntryInput) {
    return ipcRenderer.invoke('profile:create', input)
  },

  updateProfileEntry(id: string, updates: UpdateProfileEntryInput) {
    return ipcRenderer.invoke('profile:update', { id, updates })
  },

  deleteProfileEntry(id: string): Promise<void> {
    return ipcRenderer.invoke('profile:delete', id)
  },

  getUserProfile() {
    return ipcRenderer.invoke('profile:get-user')
  },

  setUserQualifications(quals: unknown): Promise<void> {
    return ipcRenderer.invoke('profile:set-qualifications', quals)
  },

  setUserYoeOverride(yoe: number | null): Promise<void> {
    return ipcRenderer.invoke('profile:set-yoe-override', yoe)
  },

  extractQualifications() {
    return ipcRenderer.invoke('profile:extract-qualifications')
  },

  exportProfileMarkdown(): Promise<string | null> {
    return ipcRenderer.invoke('profile:export')
  },

  importProfileMarkdown(): Promise<{ added: number; skipped: number } | null> {
    return ipcRenderer.invoke('profile:import')
  },

  importProfileFromResumePdf(): Promise<{ added: number; entries: ProfileEntry[] } | null> {
    return ipcRenderer.invoke('profile:import-resume-pdf')
  },

  // ── Resume ────────────────────────────────────────────────────────────────
  tailorResume(jobDescription: string, templateName: string, postingId?: string) {
    return ipcRenderer.invoke('resume:tailor', { jobDescription, templateName, postingId })
  },

  getApplications() {
    return ipcRenderer.invoke('resume:get-applications')
  },

  getAvailableTemplates() {
    return ipcRenderer.invoke('resume:get-templates')
  },

  recompileResume(applicationId: string) {
    return ipcRenderer.invoke('resume:recompile', applicationId)
  },

  renameResume(applicationId: string, name: string): Promise<void> {
    return ipcRenderer.invoke('resume:rename', applicationId, name)
  },

  // ── Search Config ──────────────────────────────────────────────────────────
  getSearchConfig(): Promise<SearchConfigRow> {
    return ipcRenderer.invoke('search:get-config')
  },

  updateSearchConfig(updates: Partial<SearchConfigRow>): Promise<void> {
    return ipcRenderer.invoke('search:update-config', updates)
  },

  // ── Search Terms ───────────────────────────────────────────────────────────
  getSearchTerms(): Promise<SearchTerm[]> {
    return ipcRenderer.invoke('search-terms:get')
  },

  generateSearchTerms(constraints?: GenConstraints): Promise<SearchTerm[]> {
    return ipcRenderer.invoke('search-terms:generate', constraints)
  },

  generateSearchTermsFromProfile(constraints?: GenConstraints): Promise<SearchTerm[]> {
    return ipcRenderer.invoke('search-terms:generate-from-profile', constraints)
  },

  updateSearchTerm(id: string, updates: {
    term?: string
    enabled?: boolean
    locations?: string[] | null
    seniorities?: SearchTermSeniority[] | null
    work_type?: WorkType[] | null
    recency?: Recency | null
    max_results?: number | null
  }): Promise<void> {
    return ipcRenderer.invoke('search-terms:update', { id, updates })
  },

  addSearchTerm(data: AddSearchTermData): Promise<SearchTerm> {
    return ipcRenderer.invoke('search-terms:add', { data })
  },

  deleteSearchTerm(id: string): Promise<void> {
    return ipcRenderer.invoke('search-terms:delete', id)
  },

  suggestLocations(query: string): Promise<string[]> {
    return ipcRenderer.invoke('location:suggest', query)
  },

  // ── Ban List ───────────────────────────────────────────────────────────────
  getBanList(): Promise<BanListEntry[]> {
    return ipcRenderer.invoke('ban-list:get')
  },

  addBanEntry(entry: {
    type: 'company' | 'domain'
    value: string
    reason?: string
  }): Promise<{ entry: BanListEntry; deletedCount: number }> {
    return ipcRenderer.invoke('ban-list:add', entry)
  },

  removeBanEntry(id: string): Promise<void> {
    return ipcRenderer.invoke('ban-list:remove', id)
  },

  previewBanMatch(type: 'company' | 'domain', value: string): Promise<number> {
    return ipcRenderer.invoke('ban-list:preview', { type, value })
  },

  // ── Jobs ───────────────────────────────────────────────────────────────────
  listAdapters() {
    return ipcRenderer.invoke('jobs:list-adapters')
  },

  installChromium() {
    return ipcRenderer.invoke('playwright:install-chromium')
  },

  runScrape(adapterIds?: string[], loginAdapterIds?: string[]) {
    return ipcRenderer.invoke('jobs:run-scrape', adapterIds, loginAdapterIds)
  },

  pauseScrape(): Promise<void> {
    return ipcRenderer.invoke('jobs:pause-scrape')
  },

  resumeScrape(): Promise<void> {
    return ipcRenderer.invoke('jobs:resume-scrape')
  },

  abortScrape(): Promise<void> {
    return ipcRenderer.invoke('jobs:abort-scrape')
  },

  getPostings() {
    return ipcRenderer.invoke('jobs:get-postings')
  },

  updatePostingStatus(id: string, status: PostingStatus): Promise<void> {
    return ipcRenderer.invoke('jobs:update-status', { id, status })
  },

  deletePostings(ids: string[]): Promise<void> {
    return ipcRenderer.invoke('jobs:delete-postings', { ids })
  },

  listArchivedPostings(): Promise<JobPosting[]> {
    return ipcRenderer.invoke('jobs:list-archived')
  },

  getArchivedCount(): Promise<number> {
    return ipcRenderer.invoke('jobs:archived-count')
  },

  unarchivePosting(id: string): Promise<void> {
    return ipcRenderer.invoke('jobs:unarchive', { id })
  },

  deleteAllArchived(): Promise<number> {
    return ipcRenderer.invoke('jobs:delete-all-archived')
  },

  // ── Tracker ────────────────────────────────────────────────────────────────
  getTrackerPostings() {
    return ipcRenderer.invoke('tracker:get-postings')
  },

  listArchivedTrackerPostings() {
    return ipcRenderer.invoke('tracker:list-archived')
  },

  getTrackerArchivedCount(): Promise<number> {
    return ipcRenderer.invoke('tracker:archived-count')
  },

  deleteAllTrackerArchived(): Promise<number> {
    return ipcRenderer.invoke('tracker:delete-all-archived')
  },

  // ── Analytics ──────────────────────────────────────────────────────────────
  getAnalyticsFunnel() {
    return ipcRenderer.invoke('analytics:funnel')
  },

  getAnalyticsBySource() {
    return ipcRenderer.invoke('analytics:by-source')
  },

  getAnalyticsBySeniority() {
    return ipcRenderer.invoke('analytics:by-seniority')
  },

  getAnalyticsWeekly() {
    return ipcRenderer.invoke('analytics:weekly')
  },

  getAnalyticsLLMCost() {
    return ipcRenderer.invoke('analytics:llm-cost')
  },

  getAnalyticsLLMCostByType() {
    return ipcRenderer.invoke('analytics:llm-cost-by-type')
  },

  // ── Backup / Export / Import ───────────────────────────────────────────────
  createBackup(): Promise<string | null> {
    return ipcRenderer.invoke('backup:create')
  },

  exportData(): Promise<string | null> {
    return ipcRenderer.invoke('data:export')
  },

  importData(mode: 'merge' | 'replace'): Promise<{ imported: number } | null> {
    return ipcRenderer.invoke('data:import', mode)
  },

  importDataFromFile(mode: 'merge' | 'replace', filePath: string): Promise<{ imported: number }> {
    return ipcRenderer.invoke('data:import-file', { mode, filePath })
  },

  // ── Events ─────────────────────────────────────────────────────────────────
  onScrapingCommitted(cb: () => void): void {
    ipcRenderer.on('jobs:scrape-committed', () => cb())
  },

  onPostingCommitted(cb: (posting: JobPosting) => void): (() => void) {
    const handler = (_event: Electron.IpcRendererEvent, posting: JobPosting) => cb(posting)
    ipcRenderer.on('jobs:posting-committed', handler)
    return () => ipcRenderer.removeListener('jobs:posting-committed', handler)
  },

  onPostingScored(cb: (posting: JobPosting) => void): (() => void) {
    const handler = (_event: Electron.IpcRendererEvent, posting: JobPosting) => cb(posting)
    ipcRenderer.on('jobs:posting-scored', handler)
    return () => ipcRenderer.removeListener('jobs:posting-scored', handler)
  },

  onAffinityUpdated(cb: (postings: JobPosting[]) => void): void {
    ipcRenderer.on('jobs:affinity-updated', (_event, postings: JobPosting[]) => cb(postings))
  },

  onAdapterProgress(cb: (p: AdapterProgress) => void): void {
    ipcRenderer.on('jobs:adapter-progress', (_event, p: AdapterProgress) => cb(p))
  },

  onCaptchaRequired(cb: (req: CaptchaRequest) => void): void {
    ipcRenderer.on('jobs:captcha-required', (_event, req: CaptchaRequest) => cb(req))
  },

  resolveCaptcha(adapterId: string): Promise<void> {
    return ipcRenderer.invoke('jobs:captcha-resolved', adapterId)
  },

  onLoginRequired(cb: (req: LoginRequest) => void): void {
    ipcRenderer.on('jobs:login-required', (_event, req: LoginRequest) => cb(req))
  },

  resolveLogin(adapterId: string): Promise<void> {
    return ipcRenderer.invoke('jobs:login-resolved', adapterId)
  },
} satisfies ElectronAPI)

if (process.env.APP_TEST === '1') {
  contextBridge.exposeInMainWorld('testApi', {
    triggerClaudeQuotaLock(reason: 'rate_limit' | 'credit_balance' | 'overloaded' | 'auth'): Promise<void> {
      return ipcRenderer.invoke('test:trigger-claude-quota-lock', reason)
    },
    archiveOldest(n: number): Promise<string[]> {
      return ipcRenderer.invoke('test:archive-oldest', n)
    },
    backdatePostings(ids: string[], status: string): Promise<void> {
      return ipcRenderer.invoke('test:backdate-postings', { ids, status })
    },
    runArchiveSweep(retentionDays: number): Promise<number> {
      return ipcRenderer.invoke('test:run-archive-sweep', retentionDays)
    },
    archiveFavorited(): Promise<void> {
      return ipcRenderer.invoke('test:archive-favorited')
    },
    countArchived(): Promise<number> {
      return ipcRenderer.invoke('test:count-archived')
    },
    getAllPostingIds(): Promise<string[]> {
      return ipcRenderer.invoke('test:get-all-posting-ids')
    },
    getRawText(id: string): Promise<string | null> {
      return ipcRenderer.invoke('test:get-raw-text', id)
    },
  })
}
