import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AppSettings, SettingsUpdate } from '@shared/types'

interface StoredSettings {
  /** Base64 of safeStorage-encrypted key, or plain 'plain:'-prefixed fallback. */
  apiKeyEncrypted: string
  transcriptionModel: string
  analysisModel: string
}

const DEFAULTS: StoredSettings = {
  apiKeyEncrypted: '',
  transcriptionModel: 'whisper-1',
  analysisModel: 'gpt-4o-mini'
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

let cache: StoredSettings | null = null

function load(): StoredSettings {
  if (cache) return cache
  try {
    if (existsSync(settingsPath())) {
      cache = { ...DEFAULTS, ...(JSON.parse(readFileSync(settingsPath(), 'utf8')) as Partial<StoredSettings>) }
      return cache
    }
  } catch {
    /* corrupted settings fall back to defaults */
  }
  cache = { ...DEFAULTS }
  return cache
}

function persist(s: StoredSettings): void {
  cache = s
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(settingsPath(), JSON.stringify(s, null, 2), 'utf8')
}

function encryptKey(key: string): string {
  if (key === '') return ''
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(key).toString('base64')
  }
  // Headless Linux without a keyring: store obfuscated-but-recoverable.
  return 'plain:' + Buffer.from(key, 'utf8').toString('base64')
}

function decryptKey(stored: string): string {
  if (stored === '') return ''
  try {
    if (stored.startsWith('plain:')) {
      return Buffer.from(stored.slice(6), 'base64').toString('utf8')
    }
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch {
    return ''
  }
}

export function getApiKey(): string {
  const envKey = process.env.OPENAI_API_KEY
  const stored = decryptKey(load().apiKeyEncrypted)
  return stored || envKey || ''
}

export function getSettings(): AppSettings {
  const s = load()
  const key = getApiKey()
  return {
    hasApiKey: key.length > 0,
    apiKeyMasked: key.length > 8 ? `${key.slice(0, 5)}…${key.slice(-4)}` : key ? '•••' : '',
    transcriptionModel: s.transcriptionModel,
    analysisModel: s.analysisModel
  }
}

export function updateSettings(update: SettingsUpdate): AppSettings {
  const s = { ...load() }
  if (update.apiKey !== undefined) s.apiKeyEncrypted = encryptKey(update.apiKey.trim())
  if (update.transcriptionModel !== undefined && update.transcriptionModel.trim()) {
    s.transcriptionModel = update.transcriptionModel.trim()
  }
  if (update.analysisModel !== undefined && update.analysisModel.trim()) {
    s.analysisModel = update.analysisModel.trim()
  }
  persist(s)
  return getSettings()
}
