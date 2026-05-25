import { ipcMain, dialog } from 'electron'
import fs from 'fs'
import { getDb } from '../../db/database'
import { getApiKey } from '../settings'
import { logger } from '../logger'
import {
  getAllEntries,
  createEntry,
  updateEntry,
  deleteEntry,
  getUserProfile,
  setUserQualifications,
  setUserYoeOverride,
  exportToMarkdown,
  importFromMarkdown,
  countWords,
} from '../../core/profile/repository'
import { importProfileFromResumePdf } from '../../core/profile/resumeImporter'
import { extractQualifications } from '../../core/profile/qualsExtractor'
import { CreateProfileEntrySchema, UpdateProfileEntrySchema, UserQualificationsSchema } from '../../core/profile/models'
import { getSettings } from '../settings'
import type { FeatureLocks, ClaudeQuotaLock } from '../../src/shared/ipc-types'
import type { ClaudeQuotaError } from '../../core/llm/quotaErrors'

export function registerProfileHandlers(
  pushFeatureLocks: (patch: Partial<FeatureLocks>) => void,
  triggerClaudeQuotaLock: (err: ClaudeQuotaError) => void,
  getClaudeQuotaLock: () => ClaudeQuotaLock | null,
): void {
  ipcMain.handle('profile:get-all', () => getAllEntries(getDb()))

  ipcMain.handle('profile:create', (_event, input: unknown) => {
    const parsed = CreateProfileEntrySchema.safeParse(input)
    if (!parsed.success) throw new Error(parsed.error.message)
    const settings = getSettings()
    const wc = countWords(parsed.data.content)
    if (wc > settings.profile_entry_word_limit) {
      throw new Error(
        `Content exceeds word limit of ${settings.profile_entry_word_limit} words (${wc} found)`,
      )
    }
    return createEntry(getDb(), parsed.data)
  })

  ipcMain.handle(
    'profile:update',
    (_event, { id, updates }: { id: string; updates: unknown }) => {
      const parsed = UpdateProfileEntrySchema.safeParse(updates)
      if (!parsed.success) throw new Error(parsed.error.message)
      if (parsed.data.content !== undefined) {
        const settings = getSettings()
        const wc = countWords(parsed.data.content)
        if (wc > settings.profile_entry_word_limit) {
          throw new Error(
            `Content exceeds word limit of ${settings.profile_entry_word_limit} words (${wc} found)`,
          )
        }
      }
      return updateEntry(getDb(), id, parsed.data)
    },
  )

  ipcMain.handle('profile:delete', (_event, id: string) => {
    deleteEntry(getDb(), id)
  })

  ipcMain.handle('profile:get-user', () => getUserProfile(getDb()))

  ipcMain.handle('profile:set-qualifications', (_event, input: unknown) => {
    const parsed = UserQualificationsSchema.safeParse(input)
    if (!parsed.success) throw new Error(parsed.error.message)
    setUserQualifications(getDb(), parsed.data)
  })

  ipcMain.handle('profile:set-yoe-override', (_event, yoe: unknown) => {
    if (yoe === null) {
      setUserYoeOverride(getDb(), null)
      return
    }
    if (typeof yoe !== 'number' || !Number.isFinite(yoe) || yoe < 0) {
      throw new Error('yoe must be a non-negative number or null')
    }
    setUserYoeOverride(getDb(), yoe)
  })

  ipcMain.handle('profile:extract-qualifications', async () => {
    const lock = getClaudeQuotaLock()
    if (lock) throw new Error(`Claude features locked (${lock.reason}) — clear in Settings`)
    const apiKey = getApiKey()
    if (!apiKey) throw new Error('No API key stored — set one in Settings first')
    const result = await extractQualifications(getDb(), apiKey, triggerClaudeQuotaLock)
    logger.info('Profile qualifications extracted', result.qualifications)
    return result
  })

  ipcMain.handle('profile:export', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: 'profile.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
    if (canceled || !filePath) return null
    const markdown = exportToMarkdown(getDb())
    fs.writeFileSync(filePath, markdown, 'utf-8')
    logger.info('Profile exported', { filePath })
    return filePath
  })

  ipcMain.handle('profile:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      properties: ['openFile'],
    })
    if (canceled || !filePaths[0]) return null
    const markdown = fs.readFileSync(filePaths[0], 'utf-8')
    const result = importFromMarkdown(getDb(), markdown)
    logger.info('Profile imported', result)
    return result
  })

  ipcMain.handle('profile:import-resume-pdf', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      filters: [{ name: 'PDF Resume', extensions: ['pdf'] }],
      properties: ['openFile'],
    })
    if (canceled || !filePaths[0]) return null

    const lock = getClaudeQuotaLock()
    if (lock) throw new Error(`Claude features locked (${lock.reason}) — clear in Settings`)

    const apiKey = getApiKey()
    if (!apiKey) throw new Error('No API key stored — set one in Settings first')

    const pdfBuffer = fs.readFileSync(filePaths[0])
    const pdfBase64 = pdfBuffer.toString('base64')

    const result = await importProfileFromResumePdf(apiKey, pdfBase64, getDb(), triggerClaudeQuotaLock)
    logger.info('Profile imported from resume PDF', { added: result.added })

    if (result.added > 0) {
      pushFeatureLocks({ profileEmpty: false })
    }

    return result
  })
}
