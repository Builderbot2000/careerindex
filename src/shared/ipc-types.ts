// ─── Profile ──────────────────────────────────────────────────────────────────

export type ProfileEntryType =
  | 'experience'
  | 'credential'
  | 'accomplishment'
  | 'skill'
  | 'education'

export interface ProfileEntry {
  id: string
  type: ProfileEntryType
  title: string
  content: string
  tags: string[]
  start_date: string | null
  end_date: string | null
  created_at: string
}

export interface LanguageItem {
  name: string
  proficiency: string
}

export interface CitizenshipItem {
  country: string
  status: string
}

export interface UserProfile {
  id: number
  yoe: number | null
  yoe_industry: string[]
  languages: LanguageItem[]
  citizenship: CitizenshipItem[]
  drivers_license: boolean
}

export interface UserQualificationsInput {
  yoe_industry: string[]
  languages: LanguageItem[]
  citizenship: CitizenshipItem[]
  drivers_license: boolean
}

export type CreateProfileEntryInput = Omit<ProfileEntry, 'id' | 'created_at'>
export type UpdateProfileEntryInput = Partial<Omit<ProfileEntry, 'id' | 'created_at'>>

// ─── Resume ───────────────────────────────────────────────────────────────────

export interface ResumeExperience {
  company: string
  role: string
  start_date: string
  end_date: string
  bullets: string[]
}

export interface ResumeSkills {
  languages: string[]
  frameworks: string[]
  tools: string[]
}

export interface ResumeEducation {
  institution: string
  degree: string
  year: string
}

export interface ResumeData {
  summary: string
  experience: ResumeExperience[]
  skills: ResumeSkills
  education: ResumeEducation[]
  credentials: string[]
}

export interface Application {
  id: string
  posting_id: string | null
  tex_path: string
  resume_json: string
  schema_version: number
  applied_at: string | null
  notes: string
  name: string | null
  template_name: string
}

export interface TailorResumeResult {
  application: Application
  pdfUrl: string
}

// ─── Jobs ─────────────────────────────────────────────────────────────────────

export type PostingStatus =
  | 'new'
  | 'viewed'
  | 'favorited'
  | 'applied'
  | 'interviewing'
  | 'offer'
  | 'rejected'
  | 'ghosted'

export type Seniority = 'intern' | 'junior' | 'mid' | 'senior' | 'staff' | 'any'
export type SearchTermSeniority = 'intern' | 'junior' | 'mid' | 'senior' | 'staff'
export type WorkType = 'remote' | 'hybrid' | 'onsite'
export type Recency = 'day' | 'week' | 'month'

export interface JobPosting {
  id: string
  source: string
  url: string
  resolved_domain: string | null
  title: string
  company: string
  location: string
  yoe_min: number | null
  yoe_max: number | null
  seniority: Seniority
  tech_stack: string[]
  posted_at: string | null
  applicant_count: number | null
  raw_text: string | null
  fetched_at: string
  scraper_mod_version: string
  status: PostingStatus
  affinity_score: number | null
  affinity_skipped: boolean
  affinity_scored_at: string | null
  affinity_reasoning: string | null
  description_snippet: string | null
  hard_reqs_class: 'overqualified' | 'fully_qualified' | 'minimally_qualified' | 'underqualified' | null
  nice_to_haves_class: 'fully_met' | 'partially_met' | 'not_met' | null
  first_response_at: string | null
  last_seen_at: string
  archived_at: string | null
}

export interface TrackerPosting extends JobPosting {
  applied_at: string | null
}

export interface SearchConfigRow {
  intent: string | null
  term_generation_hash: string | null
  ranking_weights: string        // JSON: Record<string, number>
  excluded_stack: string         // JSON: string[]
  required_keywords: string      // JSON: string[]
  excluded_keywords: string      // JSON: string[]
  keyword_match_fields: string   // JSON: string[]
}

export interface ScrapeSummary {
  fetched: number
  dupes: number
  netNew: number
  ban_excluded: number
  keyword_filtered: number
  term_filtered: number
}

export interface AdapterInfo {
  id: string
  name: string
  description: string
  available: boolean
  supportsLogin: boolean
  requiresChromium: boolean
}

export interface AdapterProgress {
  adapterId: string
  status: 'running' | 'done' | 'error'
  fetched?: number
  error?: string
}

export interface CaptchaRequest {
  adapterId: string
  adapterName: string
}

export interface LoginRequest {
  adapterId: string
  adapterName: string
}

// ─── Search terms ─────────────────────────────────────────────────────────────

export interface SearchTerm {
  id: string
  term: string
  enabled: boolean
  source: 'llm_generated' | 'user_added'
  created_at: string
  locations: string[] | null
  seniorities: SearchTermSeniority[] | null
  work_type: WorkType[] | null
  recency: Recency | null
  max_results: number | null
}

export interface AddSearchTermData {
  role: string
  locations?: string[] | null
  seniorities?: SearchTermSeniority[] | null
  work_type?: WorkType[] | null
  recency?: Recency | null
  max_results?: number | null
}

export interface GenConstraints {
  locations?: string[] | null
  seniorities?: SearchTermSeniority[] | null
  work_type?: WorkType[] | null
  recency?: Recency | null
  max_results?: number | null
}

// ─── Ban list ─────────────────────────────────────────────────────────────────

export interface BanListEntry {
  id: string
  type: 'company' | 'domain'
  value: string
  reason: string | null
  created_at: string
}

// ─── LLM usage ────────────────────────────────────────────────────────────────

export interface LLMUsageRecord {
  id: string
  call_type: 'search_term_gen' | 'affinity_scoring' | 'resume_tailoring'
  model: string
  input_tokens: number
  output_tokens: number
  estimated_cost: number
  called_at: string
  posting_id: string | null
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export interface FunnelSummary {
  applied: number
  interviewing: number
  offer: number
  rejected: number
  ghosted: number
  response_rate: number   // (interviewing + offer + rejected) / applied; NaN if 0 applied
  conversion_rate: number // offer / applied
}

export interface SourceMetric {
  source: string
  count: number
  response_rate: number
  avg_days_to_response: number | null
}

export interface SeniorityMetric {
  seniority: string
  count: number
  response_rate: number
}

export interface WeeklyMetric {
  week: string  // ISO week label "YYYY-Www"
  applications: number
}

export interface LLMCostSummary {
  all_time: number
  current_month: number
}

export interface LLMCostByType {
  call_type: string
  total_cost: number
  call_count: number
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface Settings {
  pdf_export_path: string | null
  crawl_delay_ms: number
  posting_retention_days: number
  profile_entry_word_limit: number
  log_retention_days: number
  parse_error_abort_threshold: number
  affinity_token_budget: number
  log_level: 'error' | 'warn' | 'info' | 'debug'
}

export type SettingKey = keyof Settings

export type ClaudeQuotaReason = 'rate_limit' | 'credit_balance' | 'overloaded' | 'auth'

export interface ClaudeQuotaLock {
  reason: ClaudeQuotaReason
  message: string
  occurredAt: number
}

export interface FeatureLocks {
  /** True = no API key stored → Claude features locked */
  claudeApiKey: boolean
  /** True = API unreachable at startup → Claude features locked */
  claudeConnectivity: boolean
  /** Non-null = last Claude call hit a quota/auth/overload error → all Claude features locked */
  claudeQuotaLock: ClaudeQuotaLock | null
  /** True = Typst binary not found → resume compilation locked */
  typst: boolean
  /** True = Playwright Chromium absent → Playwright scrapers locked */
  playwrightChromium: boolean
  /** True = no profile entries → resume tailoring locked */
  profileEmpty: boolean
}

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available'; version: string }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string; disabledInDev?: boolean }

/** Shape of window.api as exposed by the context bridge. */
export interface ElectronAPI {
  onFeatureLocks(cb: (locks: FeatureLocks) => void): void
  refreshFeatureLocks(): Promise<void>
  clearClaudeQuotaLock(): Promise<void>
  checkForUpdates(): Promise<void>
  downloadUpdate(): Promise<void>
  quitAndInstallUpdate(): Promise<void>
  getUpdateStatus(): Promise<UpdateStatus>
  onUpdateStatus(cb: (status: UpdateStatus) => void): void
  getSettings(): Promise<Settings>
  updateSetting(key: SettingKey, value: Settings[SettingKey]): Promise<void>
  getApiKeyPresent(): Promise<boolean>
  setApiKey(key: string): Promise<void>
  deleteApiKey(): Promise<void>
  openExternal(url: string): Promise<void>

  // Profile
  getProfileEntries(): Promise<ProfileEntry[]>
  createProfileEntry(input: CreateProfileEntryInput): Promise<ProfileEntry>
  updateProfileEntry(id: string, updates: UpdateProfileEntryInput): Promise<ProfileEntry>
  deleteProfileEntry(id: string): Promise<void>
  getUserProfile(): Promise<UserProfile>
  setUserYoe(yoe: number | null): Promise<void>
  setUserQualifications(quals: UserQualificationsInput): Promise<void>
  exportProfileMarkdown(): Promise<string | null>
  importProfileMarkdown(): Promise<{ added: number; skipped: number } | null>
  importProfileFromResumePdf(): Promise<{ added: number; entries: ProfileEntry[] } | null>

  // Resume
  tailorResume(
    jobDescription: string,
    templateName: string,
    postingId?: string,
  ): Promise<TailorResumeResult>
  getApplications(): Promise<Application[]>
  getAvailableTemplates(): Promise<string[]>
  recompileResume(applicationId: string): Promise<string>
  renameResume(applicationId: string, name: string): Promise<void>

  // Search config
  getSearchConfig(): Promise<SearchConfigRow>
  updateSearchConfig(updates: Partial<SearchConfigRow>): Promise<void>

  // Search terms
  getSearchTerms(): Promise<SearchTerm[]>
  generateSearchTerms(constraints?: GenConstraints): Promise<SearchTerm[]>
  generateSearchTermsFromProfile(constraints?: GenConstraints): Promise<SearchTerm[]>
  updateSearchTerm(id: string, updates: {
    term?: string
    enabled?: boolean
    locations?: string[] | null
    seniorities?: SearchTermSeniority[] | null
    work_type?: WorkType[] | null
    recency?: Recency | null
    max_results?: number | null
  }): Promise<void>
  suggestLocations(query: string): Promise<string[]>
  addSearchTerm(data: AddSearchTermData): Promise<SearchTerm>
  deleteSearchTerm(id: string): Promise<void>

  // Ban list
  getBanList(): Promise<BanListEntry[]>
  addBanEntry(entry: { type: 'company' | 'domain'; value: string; reason?: string }): Promise<{ entry: BanListEntry; deletedCount: number }>
  removeBanEntry(id: string): Promise<void>
  previewBanMatch(type: 'company' | 'domain', value: string): Promise<number>

  // Jobs
  listAdapters(): Promise<AdapterInfo[]>
  installChromium(): Promise<void>
  runScrape(adapterIds?: string[], loginAdapterIds?: string[]): Promise<ScrapeSummary>
  pauseScrape(): Promise<void>
  resumeScrape(): Promise<void>
  abortScrape(): Promise<void>
  getPostings(): Promise<JobPosting[]>
  updatePostingStatus(id: string, status: PostingStatus): Promise<void>
  deletePostings(ids: string[]): Promise<void>
  listArchivedPostings(): Promise<JobPosting[]>
  getArchivedCount(): Promise<number>
  unarchivePosting(id: string): Promise<void>
  deleteAllArchived(): Promise<number>

  // Tracker
  getTrackerPostings(): Promise<TrackerPosting[]>
  listArchivedTrackerPostings(): Promise<TrackerPosting[]>
  getTrackerArchivedCount(): Promise<number>
  deleteAllTrackerArchived(): Promise<number>

  // Analytics
  getAnalyticsFunnel(): Promise<FunnelSummary>
  getAnalyticsBySource(): Promise<SourceMetric[]>
  getAnalyticsBySeniority(): Promise<SeniorityMetric[]>
  getAnalyticsWeekly(): Promise<WeeklyMetric[]>
  getAnalyticsLLMCost(): Promise<LLMCostSummary>
  getAnalyticsLLMCostByType(): Promise<LLMCostByType[]>

  // Backup + Data export/import
  createBackup(): Promise<string | null>
  exportData(): Promise<string | null>
  importData(mode: 'merge' | 'replace'): Promise<{ imported: number } | null>
  importDataFromFile(mode: 'merge' | 'replace', filePath: string): Promise<{ imported: number }>

  // Events
  onScrapingCommitted(cb: () => void): void
  onPostingCommitted(cb: (posting: JobPosting) => void): (() => void)
  onPostingScored(cb: (posting: JobPosting) => void): (() => void)
  onAffinityUpdated(cb: (postings: JobPosting[]) => void): void
  onAdapterProgress(cb: (p: AdapterProgress) => void): void
  onCaptchaRequired(cb: (req: CaptchaRequest) => void): void
  resolveCaptcha(adapterId: string): Promise<void>
  onLoginRequired(cb: (req: LoginRequest) => void): void
  resolveLogin(adapterId: string): Promise<void>
}
