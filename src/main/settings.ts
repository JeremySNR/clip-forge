import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AppSettings,
  BrandingSettings,
  BrandVoiceSettings,
  BrowserCookieSource,
  EncoderPreference,
  QualityPreference,
  SettingsUpdate,
  WorkvivoPublicSettings
} from '@shared/types'
import { getGpuStatus } from './pipeline/encoders'
import { deriveWorkvivoApiBase, type WorkvivoRequestConfig } from './pipeline/workvivo'
import { clearImportCookiesFile, getImportCookiesPath } from './cookies'
import { DEFAULT_BRAND_COLORS } from '@shared/captionStyles'

/** Persisted WorkVivo connection; token encrypted like the OpenAI key. */
interface StoredWorkvivo {
  url: string
  companyId: string
  tokenEncrypted: string
  postAsUserId: string
  defaultSpaceId: string
  /**
   * Largest upload the API has been seen to accept, in bytes. WorkVivo does
   * not document this (its OpenAPI spec states no size limit on the `video`
   * field and defines no 413 response), and it is an infrastructure cap that
   * may differ per tenant, so the app learns it: a 413 halves the value, a
   * successful post confirms it.
   */
  maxUploadBytes: number
}

interface StoredSettings {
  /** Base64 of safeStorage-encrypted key, or plain 'plain:'-prefixed fallback. */
  apiKeyEncrypted: string
  transcriptionModel: string
  /** ISO-639-1 language code forced on Whisper, or 'auto' to auto-detect. */
  transcriptionLanguage: string
  analysisModel: string
  encoder: EncoderPreference
  quality: QualityPreference
  branding: BrandingSettings
  brandVoice: BrandVoiceSettings
  importCookiesBrowser: BrowserCookieSource
  workvivo: StoredWorkvivo
}

const DEFAULT_BRANDING: BrandingSettings = {
  enabled: false,
  imagePath: null,
  position: 'bottom-right',
  opacity: 0.8,
  scale: 0.16,
  colors: DEFAULT_BRAND_COLORS
}

const DEFAULT_BRAND_VOICE: BrandVoiceSettings = {
  brandName: '',
  tone: '',
  style: '',
  avoid: ''
}

/**
 * Starting guess for WorkVivo's undocumented request-size cap. Sized just
 * under a 20MB limit, which is where the observed 413s point once single-pass
 * ABR overshoot is accounted for. Wrong guesses self-correct on the first 413.
 */
export const WORKVIVO_DEFAULT_UPLOAD_CAP_BYTES = 18 * 1024 * 1024

/** Below this there is no point re-rendering; the clip is simply too long. */
export const WORKVIVO_MIN_UPLOAD_CAP_BYTES = 4 * 1024 * 1024

const DEFAULT_WORKVIVO: StoredWorkvivo = {
  url: '',
  companyId: '',
  tokenEncrypted: '',
  postAsUserId: '',
  defaultSpaceId: '',
  maxUploadBytes: WORKVIVO_DEFAULT_UPLOAD_CAP_BYTES
}

const DEFAULTS: StoredSettings = {
  apiKeyEncrypted: '',
  transcriptionModel: 'whisper-1',
  // Default to English rather than Whisper's auto-detect: the app is
  // English-first, and auto-detect occasionally mislabels English speech as a
  // similar-sounding language (e.g. Welsh). Users of other languages can pick
  // theirs — or 'auto' — in Settings.
  transcriptionLanguage: 'en',
  analysisModel: 'gpt-5.4-mini',
  encoder: 'auto',
  quality: 'standard',
  branding: DEFAULT_BRANDING,
  brandVoice: DEFAULT_BRAND_VOICE,
  importCookiesBrowser: '',
  workvivo: DEFAULT_WORKVIVO
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
        // Nested objects: merge so settings saved before new fields stay valid.
        branding: {
          ...DEFAULT_BRANDING,
          ...(parsed.branding ?? {}),
          colors: { ...DEFAULT_BRAND_COLORS, ...(parsed.branding?.colors ?? {}) }
        },
        brandVoice: { ...DEFAULT_BRAND_VOICE, ...(parsed.brandVoice ?? {}) },
        workvivo: { ...DEFAULT_WORKVIVO, ...(parsed.workvivo ?? {}) }
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
    transcriptionLanguage: s.transcriptionLanguage,
    analysisModel: s.analysisModel,
    encoder: s.encoder,
    quality: s.quality,
    gpu: await getGpuStatus(),
    branding: s.branding,
    brandVoice: s.brandVoice,
    appVersion: app.getVersion(),
    importCookiesBrowser: s.importCookiesBrowser,
    hasImportCookiesFile: getImportCookiesPath() !== null,
    workvivo: getWorkvivoPublicSettings()
  }
}

function getWorkvivoPublicSettings(): WorkvivoPublicSettings {
  const w = load().workvivo
  const token = decryptKey(w.tokenEncrypted)
  return {
    url: w.url,
    companyId: w.companyId,
    postAsUserId: w.postAsUserId,
    defaultSpaceId: w.defaultSpaceId,
    maxUploadBytes: normaliseUploadCap(w.maxUploadBytes),
    hasToken: token.length > 0,
    tokenMasked: token.length > 8 ? `${token.slice(0, 4)}…${token.slice(-4)}` : token ? '•••' : '',
    configured:
      token.length > 0 && w.companyId.trim().length > 0 && deriveWorkvivoApiBase(w.url) !== null
  }
}

/** Keep a stored or user-entered cap inside sane bounds. */
function normaliseUploadCap(bytes: number | undefined): number {
  if (!Number.isFinite(bytes) || (bytes as number) <= 0) {
    return WORKVIVO_DEFAULT_UPLOAD_CAP_BYTES
  }
  return Math.max(WORKVIVO_MIN_UPLOAD_CAP_BYTES, Math.floor(bytes as number))
}

/**
 * The tenant's WorkVivo web address. Unlike `getWorkvivoConfig`, this does not
 * require the Customer API token: browser sign-in for the web upload path
 * needs only the URL.
 */
export function getWorkvivoWebUrl(): string {
  return load().workvivo.url.trim()
}

/** The cap the next WorkVivo upload should be rendered to fit. */
export function getWorkvivoUploadCap(): number {
  return normaliseUploadCap(load().workvivo.maxUploadBytes)
}

/**
 * Record what the API actually accepted or rejected, so the next post renders
 * to the right size first time instead of rediscovering the cap.
 */
export function rememberWorkvivoUploadCap(bytes: number): void {
  const s = load()
  const next = normaliseUploadCap(bytes)
  if (s.workvivo.maxUploadBytes === next) return
  s.workvivo = { ...s.workvivo, maxUploadBytes: next }
  persist(s)
}

/**
 * Resolve the WorkVivo request config (API base, org id, decrypted token) plus
 * posting preferences, or null when the integration is not fully configured.
 */
export function getWorkvivoConfig(): {
  request: WorkvivoRequestConfig
  postAsUserId: string
  defaultSpaceId: string
  /**
   * The tenant's own web address, for the browser-session upload path. This is
   * the host the user signs in to, not the central Customer API host.
   */
  webUrl: string
} | null {
  const w = load().workvivo
  const apiBase = deriveWorkvivoApiBase(w.url)
  const token = decryptKey(w.tokenEncrypted)
  if (!apiBase || !token || !w.companyId.trim()) return null
  return {
    request: { apiBase, companyId: w.companyId.trim(), token },
    postAsUserId: w.postAsUserId.trim(),
    defaultSpaceId: w.defaultSpaceId.trim(),
    webUrl: w.url.trim()
  }
}

/** Synchronous access to the URL-import preferences. */
export function getImportPreferences(): {
  importCookiesBrowser: BrowserCookieSource
  importCookiesPath: string | null
} {
  return {
    importCookiesBrowser: load().importCookiesBrowser,
    importCookiesPath: getImportCookiesPath()
  }
}

/** Synchronous access to the stored branding preferences. */
export function getBrandingSettings(): BrandingSettings {
  return load().branding
}

/** Synchronous access to the stored brand tone-of-voice settings. */
export function getBrandVoiceSettings(): BrandVoiceSettings {
  return load().brandVoice
}

/** Synchronous access to the stored encoder/quality preferences. */
export function getExportPreferences(): { encoder: EncoderPreference; quality: QualityPreference } {
  const s = load()
  return { encoder: s.encoder, quality: s.quality }
}

/** Synchronous access to the stored model preferences (no GPU probe). */
export function getModelPreferences(): {
  transcriptionModel: string
  transcriptionLanguage: string
  analysisModel: string
} {
  const s = load()
  return {
    transcriptionModel: s.transcriptionModel,
    transcriptionLanguage: s.transcriptionLanguage,
    analysisModel: s.analysisModel
  }
}

export async function updateSettings(update: SettingsUpdate): Promise<AppSettings> {
  const s = { ...load() }
  if (update.apiKey !== undefined) s.apiKeyEncrypted = encryptKey(update.apiKey.trim())
  if (update.transcriptionModel !== undefined && update.transcriptionModel.trim()) {
    s.transcriptionModel = update.transcriptionModel.trim()
  }
  if (update.transcriptionLanguage !== undefined && update.transcriptionLanguage.trim()) {
    s.transcriptionLanguage = update.transcriptionLanguage.trim()
  }
  if (update.analysisModel !== undefined && update.analysisModel.trim()) {
    s.analysisModel = update.analysisModel.trim()
  }
  if (update.encoder !== undefined) s.encoder = update.encoder
  if (update.quality !== undefined) s.quality = update.quality
  if (update.branding !== undefined) {
    const b = update.branding
    s.branding = {
      ...s.branding,
      ...b,
      ...(b.colors !== undefined ? { colors: { ...s.branding.colors, ...b.colors } } : {})
    }
  }
  if (update.brandVoice !== undefined) {
    s.brandVoice = { ...s.brandVoice, ...update.brandVoice }
  }
  if (update.importCookiesBrowser !== undefined) s.importCookiesBrowser = update.importCookiesBrowser
  if (update.clearImportCookiesFile) await clearImportCookiesFile()
  if (update.workvivo !== undefined) {
    const w = update.workvivo
    s.workvivo = {
      ...s.workvivo,
      ...(w.url !== undefined ? { url: w.url.trim() } : {}),
      ...(w.companyId !== undefined ? { companyId: w.companyId.trim() } : {}),
      ...(w.token !== undefined ? { tokenEncrypted: encryptKey(w.token.trim()) } : {}),
      ...(w.postAsUserId !== undefined ? { postAsUserId: w.postAsUserId.trim() } : {}),
      ...(w.defaultSpaceId !== undefined ? { defaultSpaceId: w.defaultSpaceId.trim() } : {}),
      ...(w.maxUploadBytes !== undefined
        ? { maxUploadBytes: normaliseUploadCap(w.maxUploadBytes) }
        : {})
    }
  }
  persist(s)
  return getSettings()
}
