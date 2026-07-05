import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AppSettings,
  BrandingSettings,
  EncoderPreference,
  QualityPreference,
  SettingsUpdate
} from '@shared/types'
import { getGpuStatus } from './pipeline/encoders'

interface StoredSettings {
  /** Base64 of safeStorage-encrypted key, or plain 'plain:'-prefixed fallback. */
  apiKeyEncrypted: string
  transcriptionModel: string
  analysisModel: string
  encoder: EncoderPreference
  quality: QualityPreference
  branding: BrandingSettings
}

const DEFAULT_BRANDING: BrandingSettings = {
  enabled: false,
  imagePath: null,
  position: 'bottom-right',
  opacity: 0.8,
  scale: 0.16
}

const DEFAULTS: StoredSettings = {
  apiKeyEncrypted: '',
  transcriptionModel: 'whisper-1',
  analysisModel: 'gpt-4o-mini',
  encoder: 'auto',
  quality: 'standard',
  branding: DEFAULT_BRANDING
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

let cache: StoredSettings | null = null

function load(): StoredSettings {
  if (cache) return cache
  try {
    if (existsSync(settingsPath())) {
      const parsed = JSON.parse(readFileSync(settingsPath(), 'utf8')) as Partial<StoredSettings>
      cache = {
        ...DEFAULTS,
        ...parsed,
        // Nested object: merge so settings saved before new fields stay valid.
        branding: { ...DEFAULT_BRANDING, ...(parsed.branding ?? {}) }
      }
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

export async function getSettings(): Promise<AppSettings> {
  const s = load()
  const key = getApiKey()
  return {
    hasApiKey: key.length > 0,
    apiKeyMasked: key.length > 8 ? `${key.slice(0, 5)}…${key.slice(-4)}` : key ? '•••' : '',
    keyStorageSecure: safeStorage.isEncryptionAvailable(),
    transcriptionModel: s.transcriptionModel,
    analysisModel: s.analysisModel,
    encoder: s.encoder,
    quality: s.quality,
    gpu: await getGpuStatus(),
    branding: s.branding
  }
}

/** Synchronous access to the stored branding preferences. */
export function getBrandingSettings(): BrandingSettings {
  return load().branding
}

/** Synchronous access to the stored encoder/quality preferences. */
export function getExportPreferences(): { encoder: EncoderPreference; quality: QualityPreference } {
  const s = load()
  return { encoder: s.encoder, quality: s.quality }
}

/** Synchronous access to the stored model preferences (no GPU probe). */
export function getModelPreferences(): { transcriptionModel: string; analysisModel: string } {
  const s = load()
  return { transcriptionModel: s.transcriptionModel, analysisModel: s.analysisModel }
}

export async function updateSettings(update: SettingsUpdate): Promise<AppSettings> {
  const s = { ...load() }
  if (update.apiKey !== undefined) s.apiKeyEncrypted = encryptKey(update.apiKey.trim())
  if (update.transcriptionModel !== undefined && update.transcriptionModel.trim()) {
    s.transcriptionModel = update.transcriptionModel.trim()
  }
  if (update.analysisModel !== undefined && update.analysisModel.trim()) {
    s.analysisModel = update.analysisModel.trim()
  }
  if (update.encoder !== undefined) s.encoder = update.encoder
  if (update.quality !== undefined) s.quality = update.quality
  if (update.branding !== undefined) s.branding = { ...s.branding, ...update.branding }
  persist(s)
  return getSettings()
}
