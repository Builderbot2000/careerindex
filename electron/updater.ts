import { app, type BrowserWindow } from 'electron'
import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater'
import { logger } from './logger'

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available'; version: string }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string; disabledInDev?: boolean }

let lastStatus: UpdateStatus = { state: 'idle' }
let getWindow: (() => BrowserWindow | null) | null = null

function broadcast(status: UpdateStatus): void {
  lastStatus = status
  getWindow?.()?.webContents.send('updates:status', status)
}

export function getLastUpdateStatus(): UpdateStatus {
  return lastStatus
}

export function initAutoUpdater(getMainWindow: () => BrowserWindow | null): void {
  getWindow = getMainWindow

  // Opt-in: don't pull the installer or stage an install until the user asks.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.logger = {
    info: (m: unknown) => logger.info(`[updater] ${String(m)}`),
    warn: (m: unknown) => logger.warn(`[updater] ${String(m)}`),
    error: (m: unknown) => logger.error(`[updater] ${String(m)}`),
    debug: (m: unknown) => logger.debug(`[updater] ${String(m)}`),
  } as never

  autoUpdater.on('checking-for-update', () => broadcast({ state: 'checking' }))
  autoUpdater.on('update-available', (info: UpdateInfo) =>
    broadcast({ state: 'available', version: info.version }),
  )
  autoUpdater.on('update-not-available', (info: UpdateInfo) =>
    broadcast({ state: 'not-available', version: info.version }),
  )
  autoUpdater.on('download-progress', (p: ProgressInfo) =>
    broadcast({ state: 'downloading', percent: Math.round(p.percent) }),
  )
  autoUpdater.on('update-downloaded', (info: UpdateInfo) =>
    broadcast({ state: 'downloaded', version: info.version }),
  )
  autoUpdater.on('error', (err: Error) =>
    broadcast({ state: 'error', message: err.message || String(err) }),
  )
}

export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) {
    broadcast({
      state: 'error',
      message: 'Update checks only run in packaged builds.',
      disabledInDev: true,
    })
    return
  }
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    broadcast({
      state: 'error',
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

export async function downloadUpdate(): Promise<void> {
  if (!app.isPackaged) return
  try {
    await autoUpdater.downloadUpdate()
  } catch (err) {
    broadcast({
      state: 'error',
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall()
}
