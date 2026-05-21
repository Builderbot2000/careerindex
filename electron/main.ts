import { app, BrowserWindow, ipcMain, dialog, session, protocol, net } from 'electron'
import path from 'path'
import fs from 'fs'
import { execFileSync } from 'child_process'
import { initLogger, logger, setLogLevel, type LogLevel } from './logger'
import { initConnectionManager, closeDb } from './connection-manager'
import { getDb } from '../db/database'
import { runMigrations } from '../db/migrations/runner'
import { getSettings, getApiKeyPresent, getApiKey } from './settings'
import type { FeatureLocks } from '../src/shared/ipc-types'
import type { ClaudeQuotaError } from '../core/llm/quotaErrors'
import { loadAdapters } from '../core/jobs/pluginLoader'
import type { BaseAdapter } from '../core/jobs/adapters/base'
import type { CrawlController } from '../core/jobs/adapters/base'
import { makeSemaphore } from '../core/jobs/scorer'
import { registerSettingsHandlers } from './handlers/settings'
import { registerProfileHandlers } from './handlers/profile'
import { registerResumeHandlers } from './handlers/resume'
import { registerSearchHandlers } from './handlers/search'
import { registerJobsHandlers } from './handlers/jobs'
import { registerTrackerHandlers } from './handlers/tracker'
import { registerAnalyticsHandlers } from './handlers/analytics'
import { registerBackupHandlers } from './handlers/backup'
import {
  initAutoUpdater,
  checkForUpdates,
  downloadUpdate,
  quitAndInstall,
  getLastUpdateStatus,
} from './updater'

const isDev = process.env.NODE_ENV === 'development'

// Must be set before loadAdapters() triggers require('playwright') inside adapter CJS files
// In dev, keep the default system Playwright cache so the local browser is found.
if (app.isPackaged) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(app.getPath('userData'), 'ms-playwright')
}

// ─── Window ───────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null
let currentFeatureLocks: FeatureLocks = {
  claudeApiKey: false,
  claudeConnectivity: false,
  claudeQuotaLock: null,
  typst: false,
  playwrightChromium: false,
  profileEmpty: false,
}

async function probeClaudeConnectivity(): Promise<boolean> {
  try {
    const key = getApiKey()
    if (!key) return false
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey: key })
    await Promise.race([
      client.models.list(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 5000),
      ),
    ])
    return true
  } catch {
    return false
  }
}

// ─── Typst binary resolution ──────────────────────────────────────────────────

function resolveTypstBin(): string {
  if (app.isPackaged) {
    if (process.platform === 'darwin') {
      return path.join(process.resourcesPath, `typst-darwin-${process.arch}`)
    }
    const ext = process.platform === 'win32' ? '.exe' : ''
    return path.join(process.resourcesPath, `typst${ext}`)
  }
  // Dev: look in <project-root>/bin/
  const name =
    process.platform === 'win32'
      ? 'typst-win32-x64.exe'
      : `typst-${process.platform}-${process.arch}`
  const devBin = path.join(__dirname, '..', '..', 'bin', name)
  if (fs.existsSync(devBin)) return devBin
  // Fallback for contributors with system-installed typst
  return 'typst'
}

function checkTypstLock(): boolean {
  try {
    const bin = resolveTypstBin()
    if (bin === 'typst') {
      try {
        execFileSync('typst', ['--version'], { stdio: 'ignore', timeout: 3000 })
        return false
      } catch {
        return true
      }
    }
    return !fs.existsSync(bin)
  } catch {
    return true
  }
}

function checkPlaywrightLock(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { registry } = require('playwright-core/lib/server/registry/index') as {
      registry: { findExecutable(n: string): { executablePath(): string | undefined } | undefined }
    }
    const chromiumPath = registry.findExecutable('chromium')?.executablePath()
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return !chromiumPath || !require('fs').existsSync(chromiumPath)
  } catch {
    return true
  }
}

/** Populated in app.whenReady() by loadAdapters() before IPC handlers run. */
let ALL_ADAPTERS: BaseAdapter[] = []

/**
 * Controller for the currently active scrape. Null when no scrape is running.
 * Used by pause/resume/abort IPC handlers.
 */
let activeCrawlController: CrawlController | null = null

/**
 * Resolvers for in-progress captcha pauses, keyed by adapter ID.
 * When the renderer calls jobs:captcha-resolved, the matching promise unblocks.
 */
const captchaResolvers = new Map<string, () => void>()

/**
 * Resolvers for in-progress login pauses, keyed by adapter ID.
 * When the renderer calls jobs:login-resolved, the matching promise unblocks.
 */
const loginResolvers = new Map<string, () => void>()
const streamScoringLimit = makeSemaphore(5)

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 920,
    minHeight: 600,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })

  if (process.env['APP_TEST'] !== '1') {
    win.once('ready-to-show', () => win.show())
  }

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}

// ─── Content Security Policy ──────────────────────────────────────────────────

function applyCSP(): void {
  if (isDev) return // CSP too strict breaks Vite HMR in dev
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' file:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: file:; font-src 'self' data:; frame-src resume:",
        ],
      },
    })
  })
}

// ─── Startup Validation ───────────────────────────────────────────────────────

async function runStartupValidation(): Promise<{
  hardBlock: false
  featureLocks: FeatureLocks
} | {
  hardBlock: true
  reason: string
}> {
  // Hard block 1: userData writable
  try {
    const userData = app.getPath('userData')
    fs.mkdirSync(userData, { recursive: true })
    const probe = path.join(userData, '.write-probe')
    fs.writeFileSync(probe, '')
    fs.unlinkSync(probe)
  } catch (e) {
    return { hardBlock: true, reason: `User data directory is not writable: ${e}` }
  }

  // Hard block 2: SQLite + migrations
  try {
    initConnectionManager()
    runMigrations(getDb(), (msg) => logger.info(msg))
  } catch (e) {
    return { hardBlock: true, reason: `Cannot open database: ${e}` }
  }

  // Auto-archive policy: move stale new/viewed postings into the archive
  // (sets archived_at + nulls raw_text). Tracker-pipeline statuses are protected.
  try {
    const settings = getSettings()
    const retentionDays = settings.posting_retention_days ?? 14
    getDb()
      .prepare(
        `UPDATE job_postings
            SET archived_at = COALESCE(archived_at, datetime('now')),
                raw_text = NULL
          WHERE status IN ('new', 'viewed')
            AND archived_at IS NULL
            AND fetched_at < date('now', '-' || ? || ' days')`,
      )
      .run(retentionDays)
  } catch (e) {
    logger.warn('Auto-archive sweep failed (non-fatal)', { error: String(e) })
  }

  // Apply persisted log level now that settings are readable
  try {
    const settings = getSettings()
    setLogLevel(settings.log_level as LogLevel)
  } catch {
    // Non-fatal — keep default log level
  }

  const featureLocks: FeatureLocks = {
    claudeApiKey: false,
    claudeConnectivity: false,
    claudeQuotaLock: null,
    typst: false,
    playwrightChromium: false,
    profileEmpty: false,
  }

  // Feature lock: Claude API key
  try {
    featureLocks.claudeApiKey = !getApiKeyPresent()
  } catch {
    featureLocks.claudeApiKey = true
  }

  // Feature lock: Claude connectivity (skip if no key — claudeApiKey lock already fires)
  if (!featureLocks.claudeApiKey) {
    featureLocks.claudeConnectivity = !(await probeClaudeConnectivity())
  }

  // Feature lock: Typst binary
  featureLocks.typst = checkTypstLock()

  // Feature lock: Playwright Chromium
  featureLocks.playwrightChromium = checkPlaywrightLock()

  // Feature lock: profile empty (table may not exist until Phase 2)
  try {
    const count = (
      getDb().prepare('SELECT COUNT(*) AS count FROM profile_entries').get() as {
        count: number
      }
    ).count
    featureLocks.profileEmpty = count === 0
  } catch {
    featureLocks.profileEmpty = true
  }

  // In test mode, unlock typst and profile locks (claudeApiKey is left real so
  // the nav lock badge renders correctly in settings tests).
  if (process.env.APP_TEST === '1') {
    featureLocks.claudeConnectivity = false
    featureLocks.typst = false
    featureLocks.profileEmpty = false
  }

  logger.info('Startup validation complete', featureLocks)
  return { hardBlock: false, featureLocks }
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

function registerIpcHandlers(appRoot: string): void {
  const getMainWindow = () => mainWindow
  const pushFeatureLocks = (patch: Partial<FeatureLocks>): void => {
    currentFeatureLocks = { ...currentFeatureLocks, ...patch }
    mainWindow?.webContents.send('startup:feature-locks', { ...currentFeatureLocks })
  }
  const triggerClaudeQuotaLock = (err: ClaudeQuotaError): void => {
    logger.warn('Claude quota lock triggered', { reason: err.reason, raw: err.raw })
    pushFeatureLocks({
      claudeQuotaLock: {
        reason: err.reason,
        message: err.message,
        occurredAt: Date.now(),
      },
    })
  }
  const getClaudeQuotaLock = () => currentFeatureLocks.claudeQuotaLock

  ipcMain.handle('startup:refresh-locks', () => {
    pushFeatureLocks({
      typst: checkTypstLock(),
      playwrightChromium: checkPlaywrightLock(),
    })
  })

  ipcMain.handle('updates:check', async () => {
    await checkForUpdates()
  })

  ipcMain.handle('updates:download', async () => {
    await downloadUpdate()
  })

  ipcMain.handle('updates:quit-and-install', () => {
    quitAndInstall()
  })

  ipcMain.handle('updates:get-status', () => getLastUpdateStatus())

  ipcMain.handle('startup:clear-claude-quota-lock', async () => {
    const ok = await probeClaudeConnectivity()
    pushFeatureLocks({
      claudeQuotaLock: null,
      claudeConnectivity: !ok,
    })
  })

  if (process.env.APP_TEST === '1') {
    ipcMain.handle('test:trigger-claude-quota-lock', (_event, reason: string) => {
      triggerClaudeQuotaLock({
        reason: reason as ClaudeQuotaError['reason'],
        message: `[test] simulated ${reason}`,
        raw: `[test] ${reason}`,
      })
    })
  }

  registerSettingsHandlers(getMainWindow, pushFeatureLocks)
  registerProfileHandlers(pushFeatureLocks, triggerClaudeQuotaLock, getClaudeQuotaLock)
  registerResumeHandlers(
    resolveTypstBin,
    () => appRoot,
    () => app.getPath('userData'),
    triggerClaudeQuotaLock,
    getClaudeQuotaLock,
  )
  registerSearchHandlers(triggerClaudeQuotaLock, getClaudeQuotaLock)
  registerJobsHandlers({
    getMainWindow,
    pushFeatureLocks,
    getAllAdapters: () => ALL_ADAPTERS,
    getCrawlController: () => activeCrawlController,
    setCrawlController: (c) => { activeCrawlController = c },
    captchaResolvers,
    loginResolvers,
    streamScoringLimit,
    getUserDataPath: () => app.getPath('userData'),
    triggerClaudeQuotaLock,
    getClaudeQuotaLock,
  })
  registerTrackerHandlers()
  registerAnalyticsHandlers()
  registerBackupHandlers()
}

// Must be called before app.ready — registers resume: as a standard secure scheme
// so the sandboxed renderer can load it in iframes (file:// is blocked cross-path).
protocol.registerSchemesAsPrivileged([
  { scheme: 'resume', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

// On Linux without a Secret Service daemon (e.g. WSL, minimal desktops),
// force safeStorage into "basic" mode so encryption is always available.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('password-store', 'basic')
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // In test mode, redirect userData to the directory provided by the test runner.
  if (process.env.APP_TEST === '1' && process.env.ELECTRON_USER_DATA) {
    app.setPath('userData', process.env.ELECTRON_USER_DATA)
  }

  // Logger needs userData path — initialize first
  initLogger('info')
  logger.info('App starting', { version: app.getVersion(), isDev })

  if (process.platform === 'linux') {
    logger.info(
      'Linux detected — D-Bus errors from Chromium (dbus/bus.cc, dbus/object_proxy.cc) ' +
      'are harmless noise from the notification/tray layer; they do not affect app function.',
    )
  }

  // Serve compiled PDFs through resume: so the sandboxed iframe can load them.
  protocol.handle('resume', (request) => {
    const filePath = decodeURIComponent(new URL(request.url).pathname)
    const absolute = process.platform === 'win32' ? filePath.slice(1) : filePath
    return net.fetch(`file://${absolute}`)
  })

  applyCSP()

  // Load adapter plugins (built-in bundles + user-dropped) before registering
  // IPC handlers so that jobs:list-adapters and jobs:run-scrape are ready.
  // In development/test mode app.getAppPath() returns out/main/ (the script dir),
  // so we resolve the project root via __dirname instead.
  const appRoot = app.isPackaged ? app.getAppPath() : path.join(__dirname, '..', '..')
  ALL_ADAPTERS = loadAdapters(appRoot, app.getPath('userData'))
  logger.info(`Loaded ${ALL_ADAPTERS.length} adapter(s): ${ALL_ADAPTERS.map((a) => a.id).join(', ')}`)

  registerIpcHandlers(appRoot)

  // In test mode, override Claude-dependent IPC handlers with deterministic stubs.
  if (process.env.APP_TEST === '1') {
    const { registerTestStubs } = await import('../tests/stubs-main')
    registerTestStubs()
  }

  const result = await runStartupValidation()

  if (result.hardBlock) {
    logger.error('Hard block on startup', { reason: result.reason })
    dialog.showErrorBox('Career Index — Cannot Start', result.reason)
    app.quit()
    return
  }

  currentFeatureLocks = result.featureLocks
  mainWindow = createWindow()

  initAutoUpdater(() => mainWindow)

  // Push feature lock state to renderer once its IPC listener is ready
  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow?.webContents.send('startup:feature-locks', result.featureLocks)
    // Auto-check for updates shortly after launch. Skipped in dev (broadcasts
    // a friendly error) and in test mode to keep e2e runs deterministic.
    if (process.env.APP_TEST !== '1') {
      setTimeout(() => {
        checkForUpdates().catch((e) => logger.warn('Update check failed', { error: String(e) }))
      }, 3000)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    closeDb()
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createWindow()
  }
})

app.on('before-quit', () => {
  closeDb()
})
