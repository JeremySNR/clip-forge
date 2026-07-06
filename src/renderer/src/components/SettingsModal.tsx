import { useEffect, useState } from 'react'
import {
  X,
  KeyRound,
  Brain,
  Check,
  ExternalLink,
  ImagePlus,
  MonitorPlay,
  RefreshCw,
  Stamp,
  Trash2,
  Type,
  Zap,
  Download,
  Languages,
  Loader2,
  Send
} from 'lucide-react'
import { useStore } from '../store'
import type {
  EncoderPreference,
  ImportProgress,
  QualityPreference,
  WatermarkPosition
} from '@shared/types'

const ANALYSIS_MODELS = ['gpt-5.4-mini', 'gpt-5.4', 'gpt-5.5', 'gpt-4o-mini']

/** Whisper transcription languages. 'auto' lets Whisper detect per video. */
const TRANSCRIPTION_LANGUAGES: Array<{ value: string; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'auto', label: 'Auto-detect' },
  { value: 'cy', label: 'Welsh' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'nl', label: 'Dutch' },
  { value: 'pl', label: 'Polish' },
  { value: 'ru', label: 'Russian' },
  { value: 'ja', label: 'Japanese' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ko', label: 'Korean' },
  { value: 'hi', label: 'Hindi' },
  { value: 'ar', label: 'Arabic' }
]

const ENCODERS: Array<{ value: EncoderPreference; label: string; hint: string }> = [
  { value: 'auto', label: 'Auto', hint: 'GPU when ready' },
  { value: 'gpu', label: 'NVIDIA GPU', hint: 'NVENC' },
  { value: 'cpu', label: 'CPU', hint: 'libx264' }
]

const QUALITIES: Array<{ value: QualityPreference; label: string; hint: string }> = [
  { value: 'draft', label: 'Draft', hint: 'Fastest' },
  { value: 'standard', label: 'Standard', hint: 'Balanced' },
  { value: 'high', label: 'High', hint: 'Best quality' }
]

const WATERMARK_POSITIONS: Array<{ value: WatermarkPosition; label: string }> = [
  { value: 'top-left', label: 'Top left' },
  { value: 'top-right', label: 'Top right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-right', label: 'Bottom right' }
]

export default function SettingsModal(): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const saveSettings = useStore((s) => s.saveSettings)
  const refreshSettings = useStore((s) => s.refreshSettings)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(settings?.analysisModel ?? 'gpt-5.4-mini')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [gpuProgress, setGpuProgress] = useState<ImportProgress | null>(null)
  const [gpuError, setGpuError] = useState<string | null>(null)

  useEffect(() => window.clipforge.onGpuProgress(setGpuProgress), [])

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await saveSettings({
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        analysisModel: model
      })
      setApiKey('')
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } finally {
      setSaving(false)
    }
  }

  const downloadGpu = async (): Promise<void> => {
    setGpuError(null)
    setGpuProgress({ progress: 0, message: 'Starting download…' })
    try {
      await window.clipforge.downloadGpuFfmpeg()
      await refreshSettings()
    } catch (err) {
      setGpuError(err instanceof Error ? err.message : String(err))
    } finally {
      setGpuProgress(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={() => setSettingsOpen(false)}
    >
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-surface-900/85 p-6 shadow-2xl shadow-black/60 backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button
            onClick={() => setSettingsOpen(false)}
            className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-surface-800 hover:text-zinc-200"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-5">
          <label className="flex items-center gap-2 text-sm font-medium">
            <KeyRound size={15} className="text-accent-400" />
            OpenAI API key
          </label>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">
            Used for Whisper transcription and clip analysis. Stored encrypted on this machine
            and never sent anywhere except the OpenAI API.
          </p>
          {settings !== null && !settings.keyStorageSecure && (
            <p className="mt-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-400">
              Your OS keychain is unavailable, so the key is stored only obfuscated on disk.
              Prefer a key with a spending limit on this machine.
            </p>
          )}
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={settings?.hasApiKey ? `Current: ${settings.apiKeyMasked}` : 'sk-…'}
            className="mt-2.5 w-full rounded-xl border border-surface-600 bg-surface-850 px-3.5 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-white/25 focus:outline-none"
          />
          <a
            href="https://platform.openai.com/api-keys"
            target="_blank"
            rel="noreferrer"
            className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-zinc-400 underline decoration-zinc-600 underline-offset-2 hover:text-zinc-200"
          >
            Get an API key <ExternalLink size={11} />
          </a>
        </div>

        <div className="mt-5">
          <label className="flex items-center gap-2 text-sm font-medium">
            <Brain size={15} className="text-accent-400" />
            Analysis model
          </label>
          <p className="mt-1 text-xs text-zinc-500">
            gpt-5.4-mini is fast and cheap; gpt-5.4 and gpt-5.5 pick moments more carefully.
            gpt-4o-mini is the budget legacy option.
          </p>
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            {ANALYSIS_MODELS.map((m) => (
              <button
                key={m}
                onClick={() => setModel(m)}
                className={`rounded-xl border px-3 py-2 text-xs font-medium transition ${
                  model === m
                    ? 'border-white/30 bg-white/[0.07] text-zinc-100'
                    : 'border-surface-600 text-zinc-400 hover:bg-surface-800'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <label className="flex items-center gap-2 text-sm font-medium">
            <Languages size={15} className="text-accent-400" />
            Transcription language
          </label>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">
            The spoken language Whisper transcribes. Leave on English (or pick yours) rather than
            Auto-detect — auto sometimes mislabels the language (e.g. English as Welsh).
          </p>
          <select
            value={settings?.transcriptionLanguage ?? 'en'}
            onChange={(e) => void saveSettings({ transcriptionLanguage: e.target.value })}
            className="mt-2.5 w-full rounded-xl border border-surface-600 bg-surface-850 px-3.5 py-2.5 text-sm text-zinc-200 focus:border-white/25 focus:outline-none"
          >
            {TRANSCRIPTION_LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-5 border-t border-surface-700 pt-5">
          <label className="flex items-center gap-2 text-sm font-medium">
            <MonitorPlay size={15} className="text-accent-400" />
            Export encoder
          </label>
          <div
            className={`mt-2 flex items-start gap-2 rounded-lg px-3 py-2 text-xs leading-relaxed ${
              settings?.gpu.available
                ? 'bg-emerald-500/10 text-emerald-400'
                : 'bg-surface-850 text-zinc-500'
            }`}
          >
            <Zap size={13} className="mt-0.5 shrink-0" />
            <span>{settings?.gpu.detail ?? 'Checking GPU…'}</span>
          </div>
          {settings?.gpu.canDownloadFfmpeg &&
            (gpuProgress ? (
              <div className="mt-2 rounded-lg border border-surface-600 px-3 py-2.5">
                <div className="flex items-center gap-2 text-xs text-zinc-300">
                  <Loader2 size={13} className="animate-spin text-zinc-300" />
                  {gpuProgress.message}
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-700">
                  <div
                    className="h-full rounded-full bg-zinc-200 transition-all"
                    style={{ width: `${Math.round(Math.max(0, gpuProgress.progress) * 100)}%` }}
                  />
                </div>
              </div>
            ) : (
              <button
                onClick={() => void downloadGpu()}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-surface-600 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:bg-surface-800"
              >
                <Download size={13} />
                Download GPU-enabled ffmpeg (~40 MB, one time)
              </button>
            ))}
          {gpuError && <p className="mt-2 text-xs text-red-400">{gpuError}</p>}
          <div className="mt-2.5 grid grid-cols-3 gap-2">
            {ENCODERS.map((e) => (
              <button
                key={e.value}
                onClick={() => void saveSettings({ encoder: e.value })}
                disabled={e.value === 'gpu' && !settings?.gpu.available}
                className={`rounded-xl border px-2 py-2 text-center transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  settings?.encoder === e.value
                    ? 'border-white/30 bg-white/[0.07] text-zinc-100'
                    : 'border-surface-600 text-zinc-400 hover:bg-surface-800'
                }`}
              >
                <div className="text-xs font-medium">{e.label}</div>
                <div className="mt-0.5 text-[10px] text-zinc-500">{e.hint}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <label className="flex items-center gap-2 text-sm font-medium">
            <MonitorPlay size={15} className="text-accent-400" />
            Export quality
          </label>
          <div className="mt-2.5 grid grid-cols-3 gap-2">
            {QUALITIES.map((q) => (
              <button
                key={q.value}
                onClick={() => void saveSettings({ quality: q.value })}
                className={`rounded-xl border px-2 py-2 text-center transition ${
                  settings?.quality === q.value
                    ? 'border-white/30 bg-white/[0.07] text-zinc-100'
                    : 'border-surface-600 text-zinc-400 hover:bg-surface-800'
                }`}
              >
                <div className="text-xs font-medium">{q.label}</div>
                <div className="mt-0.5 text-[10px] text-zinc-500">{q.hint}</div>
              </button>
            ))}
          </div>
        </div>

        <BrandingSection />
        <WorkvivoSection />
        <FontsSection />
        <UpdatesSection />

        <button
          onClick={() => void save()}
          disabled={saving}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-100 px-4 py-2.5 text-sm font-semibold text-zinc-900 transition hover:bg-white disabled:opacity-60"
        >
          {saved ? <Check size={16} /> : null}
          {saved ? 'Saved' : saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </div>
  )
}

function BrandingSection(): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const saveSettings = useStore((s) => s.saveSettings)
  const selectBrandingLogo = useStore((s) => s.selectBrandingLogo)
  const branding = settings?.branding

  return (
    <div className="mt-5 border-t border-surface-700 pt-5">
      <label className="flex items-center gap-2 text-sm font-medium">
        <Stamp size={15} className="text-accent-400" />
        Branding
      </label>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
        Overlay your logo or watermark on every clip — shown in the preview and burned into
        exports, underneath the captions.
      </p>

      <div className="mt-2.5 flex items-center justify-between gap-3 rounded-lg border border-surface-600 px-3 py-2.5">
        <span className="text-xs font-medium text-zinc-300">Watermark on exports</span>
        <button
          onClick={() => void saveSettings({ branding: { enabled: !branding?.enabled } })}
          className={`relative h-5 w-9 shrink-0 rounded-full transition ${branding?.enabled ? 'bg-zinc-100' : 'bg-surface-600'}`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${branding?.enabled ? 'left-[18px] bg-zinc-900' : 'left-0.5 bg-white'}`}
          />
        </button>
      </div>

      <div className="mt-2.5 flex items-center gap-3">
        {branding?.imagePath ? (
          <img
            src={window.clipforge.mediaUrl(branding.imagePath)}
            alt="Watermark"
            className="h-12 w-12 shrink-0 rounded-lg border border-surface-600 bg-black/40 object-contain p-1"
          />
        ) : (
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-dashed border-surface-600 text-zinc-600">
            <ImagePlus size={16} />
          </div>
        )}
        <button
          onClick={() => void selectBrandingLogo()}
          className="flex-1 rounded-lg border border-surface-600 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:bg-surface-800"
        >
          {branding?.imagePath ? 'Replace logo image…' : 'Choose logo image…'}
        </button>
        {branding?.imagePath && (
          <button
            onClick={() => void saveSettings({ branding: { imagePath: null, enabled: false } })}
            title="Remove logo"
            className="rounded-lg p-2 text-zinc-500 transition hover:bg-surface-800 hover:text-red-400"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {branding?.imagePath && (
        <>
          <div className="mt-2.5 grid grid-cols-4 gap-2">
            {WATERMARK_POSITIONS.map((p) => (
              <button
                key={p.value}
                onClick={() => void saveSettings({ branding: { position: p.value } })}
                className={`rounded-xl border px-1 py-2 text-center text-[11px] font-medium transition ${
                  branding.position === p.value
                    ? 'border-white/30 bg-white/[0.07] text-zinc-100'
                    : 'border-surface-600 text-zinc-400 hover:bg-surface-800'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <div>
              <div className="mb-1 flex justify-between text-[11px] text-zinc-500">
                <span>Size</span>
                <span>{Math.round(branding.scale * 100)}% width</span>
              </div>
              <input
                type="range"
                min={4}
                max={40}
                value={Math.round(branding.scale * 100)}
                onChange={(e) =>
                  void saveSettings({ branding: { scale: Number(e.target.value) / 100 } })
                }
                className="w-full"
              />
            </div>
            <div>
              <div className="mb-1 flex justify-between text-[11px] text-zinc-500">
                <span>Opacity</span>
                <span>{Math.round(branding.opacity * 100)}%</span>
              </div>
              <input
                type="range"
                min={5}
                max={100}
                value={Math.round(branding.opacity * 100)}
                onChange={(e) =>
                  void saveSettings({ branding: { opacity: Number(e.target.value) / 100 } })
                }
                className="w-full"
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * WorkVivo connector: posts clips straight to a chosen WorkVivo space. Auth is
 * an org-level app token (Bearer) plus the Organisation ID header — not the
 * user's SSO login — so posts appear as the configured identity.
 */
function WorkvivoSection(): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const saveSettings = useStore((s) => s.saveSettings)
  const spaces = useStore((s) => s.workvivoSpaces)
  const loadSpaces = useStore((s) => s.loadWorkvivoSpaces)
  const wv = settings?.workvivo
  // Seeded once from settings, which are loaded before this modal can open.
  const [url, setUrl] = useState(wv?.url ?? '')
  const [companyId, setCompanyId] = useState(wv?.companyId ?? '')
  const [token, setToken] = useState('')
  const [postAsUserId, setPostAsUserId] = useState(wv?.postAsUserId ?? '')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    if (wv?.configured) void loadSpaces()
  }, [wv?.configured, loadSpaces])

  const saveAndTest = async (): Promise<void> => {
    setBusy(true)
    setResult(null)
    try {
      await saveSettings({
        workvivo: {
          url,
          companyId,
          postAsUserId,
          ...(token.trim() ? { token: token.trim() } : {})
        }
      })
      setToken('')
      const test = await window.clipforge.testWorkvivo()
      setResult(test)
      if (test.ok) await loadSpaces()
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  const inputClass =
    'mt-1.5 w-full rounded-xl border border-surface-600 bg-surface-850 px-3.5 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-white/25 focus:outline-none'

  return (
    <div className="mt-5 border-t border-surface-700 pt-5">
      <label className="flex items-center gap-2 text-sm font-medium">
        <Send size={15} className="text-accent-400" />
        WorkVivo
      </label>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
        Post clips straight to a WorkVivo space. Uses an org app token (not your SSO login), so
        posts appear as the identity below. Ask a WorkVivo admin to enable API access and mint a
        token with the <span className="text-zinc-400">spaces:read</span> and posting scopes.
      </p>

      <div className="mt-3">
        <span className="text-[11px] text-zinc-500">WorkVivo URL</span>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://yourcompany.workvivo.com"
          className={inputClass}
        />
      </div>
      <div className="mt-3">
        <span className="text-[11px] text-zinc-500">Organisation ID (Workvivo-Id)</span>
        <input
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          placeholder="e.g. 12345"
          className={inputClass}
        />
      </div>
      <div className="mt-3">
        <span className="text-[11px] text-zinc-500">API key (Bearer token)</span>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={wv?.hasToken ? `Current: ${wv.tokenMasked}` : 'Paste the API token'}
          className={inputClass}
        />
      </div>
      <div className="mt-3">
        <span className="text-[11px] text-zinc-500">Post as — WorkVivo user ID (optional)</span>
        <input
          value={postAsUserId}
          onChange={(e) => setPostAsUserId(e.target.value)}
          placeholder="Shared Comms account user id"
          className={inputClass}
        />
      </div>

      {wv?.configured && spaces.length > 0 && (
        <div className="mt-3">
          <span className="text-[11px] text-zinc-500">Default space (optional)</span>
          <select
            value={wv.defaultSpaceId}
            onChange={(e) => void saveSettings({ workvivo: { defaultSpaceId: e.target.value } })}
            className={inputClass}
          >
            <option value="">No default</option>
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {result && (
        <p
          className={`mt-3 rounded-lg px-3 py-2 text-xs leading-relaxed ${
            result.ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
          }`}
        >
          {result.message}
        </p>
      )}

      <button
        onClick={() => void saveAndTest()}
        disabled={busy}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-surface-600 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:bg-surface-800 disabled:opacity-60"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
        {busy ? 'Saving & testing…' : 'Save & test connection'}
      </button>
    </div>
  )
}

function FontsSection(): React.JSX.Element {
  const customFonts = useStore((s) => s.customFonts)
  const addFonts = useStore((s) => s.addFonts)
  const removeFont = useStore((s) => s.removeFont)
  const [adding, setAdding] = useState(false)

  return (
    <div className="mt-5 border-t border-surface-700 pt-5">
      <label className="flex items-center gap-2 text-sm font-medium">
        <Type size={15} className="text-accent-400" />
        Custom fonts
      </label>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
        Upload TTF/OTF fonts to use for captions. Pick them per clip in the editor’s Captions
        section — previews and exports both use them.
      </p>

      {customFonts.length > 0 && (
        <div className="mt-2.5 space-y-1.5">
          {customFonts.map((f) => (
            <div
              key={f.fileName}
              className="flex items-center justify-between gap-3 rounded-lg border border-surface-600 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-xs font-medium text-zinc-200" style={{ fontFamily: `'${f.family}', sans-serif` }}>
                  {f.family}
                </div>
                <div className="truncate text-[10px] text-zinc-600">{f.fileName}</div>
              </div>
              <button
                onClick={() => void removeFont(f.fileName)}
                title="Remove this font"
                className="shrink-0 rounded-md p-1.5 text-zinc-600 transition hover:bg-surface-700 hover:text-red-400"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={async () => {
          setAdding(true)
          try {
            await addFonts()
          } finally {
            setAdding(false)
          }
        }}
        disabled={adding}
        className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-surface-600 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:bg-surface-800 disabled:opacity-60"
      >
        {adding ? <Loader2 size={13} className="animate-spin" /> : <Type size={13} />}
        Add font files (.ttf / .otf)
      </button>
    </div>
  )
}

function UpdatesSection(): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const updateCheck = useStore((s) => s.updateCheck)
  const checking = useStore((s) => s.checkingForUpdates)
  const checkForUpdates = useStore((s) => s.checkForUpdates)
  const updateDownload = useStore((s) => s.updateDownload)
  const downloadUpdate = useStore((s) => s.downloadUpdate)
  const installUpdate = useStore((s) => s.installUpdate)

  return (
    <div className="mt-5 border-t border-surface-700 pt-5">
      <label className="flex items-center gap-2 text-sm font-medium">
        <RefreshCw size={15} className="text-accent-400" />
        App updates
      </label>
      <p className="mt-1 text-xs text-zinc-500">
        ClipForge v{settings?.appVersion ?? '…'} — updates are checked automatically on launch.
      </p>

      {updateCheck?.updateAvailable && updateCheck.releaseUrl ? (
        updateCheck.autoUpdateSupported ? (
          <UpdateInstaller
            latestVersion={updateCheck.latestVersion ?? ''}
            releaseUrl={updateCheck.releaseUrl}
            download={updateDownload}
            onDownload={() => void downloadUpdate()}
            onInstall={() => void installUpdate()}
          />
        ) : (
          <SourceUpdater
            latestVersion={updateCheck.latestVersion ?? ''}
            releaseUrl={updateCheck.releaseUrl}
          />
        )
      ) : (
        updateCheck &&
        !checking && (
          <p
            className={`mt-2.5 rounded-lg px-3 py-2 text-xs leading-relaxed ${
              updateCheck.error ? 'bg-amber-500/10 text-amber-400' : 'bg-surface-850 text-zinc-400'
            }`}
          >
            {updateCheck.error ??
              (updateCheck.latestVersion
                ? `You're up to date (latest release is v${updateCheck.latestVersion}).`
                : "You're up to date — no newer release has been published.")}
          </p>
        )
      )}

      <button
        onClick={() => void checkForUpdates()}
        disabled={checking}
        className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-surface-600 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:bg-surface-800 disabled:opacity-60"
      >
        {checking ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <RefreshCw size={13} />
        )}
        {checking ? 'Checking…' : 'Check for updates'}
      </button>
    </div>
  )
}

/**
 * One-click update for source checkouts: the main process pulls, reinstalls,
 * rebuilds and relaunches the app; this component just drives and narrates it.
 */
function SourceUpdater({
  latestVersion,
  releaseUrl
}: {
  latestVersion: string
  releaseUrl: string
}): React.JSX.Element {
  const sourceUpdate = useStore((s) => s.sourceUpdate)
  const updateFromSource = useStore((s) => s.updateFromSource)

  switch (sourceUpdate.status) {
    case 'running':
      return (
        <div className="mt-2.5 rounded-lg border border-surface-600 px-3 py-2.5">
          <div className="flex items-center gap-2 text-xs text-zinc-300">
            <Loader2 size={13} className="animate-spin" />
            {sourceUpdate.message || 'Updating…'}
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
            Updating to v{latestVersion} — the app restarts by itself when done (about a minute).
          </p>
        </div>
      )
    case 'error':
      return (
        <>
          <p className="mt-2.5 rounded-lg bg-red-500/10 px-3 py-2 text-xs leading-relaxed text-red-400">
            {sourceUpdate.error}
          </p>
          <div className="mt-1.5 flex gap-1.5">
            <button
              onClick={() => void updateFromSource()}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-surface-600 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:bg-surface-800"
            >
              <RefreshCw size={13} />
              Retry
            </button>
            <a
              href={releaseUrl}
              target="_blank"
              rel="noreferrer"
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-surface-600 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:bg-surface-800"
            >
              <ExternalLink size={13} />
              Release page
            </a>
          </div>
        </>
      )
    case 'idle':
      return (
        <>
          <button
            onClick={() => void updateFromSource()}
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 py-2.5 text-xs font-semibold text-emerald-400 transition hover:bg-emerald-500/25"
          >
            <Download size={13} />
            Update to v{latestVersion} and restart
          </button>
          <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
            Pulls the latest code, reinstalls dependencies, rebuilds, and restarts the app (about a
            minute). Needs a git checkout — zip downloads should use the{' '}
            <a href={releaseUrl} target="_blank" rel="noreferrer" className="text-zinc-400 underline">
              release page
            </a>{' '}
            instead.
          </p>
        </>
      )
    default: {
      const exhaustive: never = sourceUpdate.status
      return exhaustive
    }
  }
}

function UpdateInstaller({
  latestVersion,
  releaseUrl,
  download,
  onDownload,
  onInstall
}: {
  latestVersion: string
  releaseUrl: string
  download: { status: 'idle' | 'downloading' | 'downloaded' | 'error'; progress: number; error?: string }
  onDownload: () => void
  onInstall: () => void
}): React.JSX.Element {
  switch (download.status) {
    case 'downloading':
      return (
        <div className="mt-2.5 rounded-lg border border-surface-600 px-3 py-2.5">
          <div className="flex items-center gap-2 text-xs text-zinc-300">
            <Loader2 size={13} className="animate-spin" />
            Downloading v{latestVersion}… {Math.round(download.progress * 100)}%
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-700">
            <div
              className="h-full rounded-full bg-emerald-400 transition-all"
              style={{ width: `${Math.round(download.progress * 100)}%` }}
            />
          </div>
        </div>
      )
    case 'downloaded':
      return (
        <button
          onClick={onInstall}
          className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-500/20 px-3 py-2.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/30"
        >
          <RefreshCw size={13} />
          Restart to finish updating to v{latestVersion}
        </button>
      )
    case 'error':
      return (
        <>
          <p className="mt-2.5 rounded-lg bg-red-500/10 px-3 py-2 text-xs leading-relaxed text-red-400">
            {download.error}
          </p>
          <a
            href={releaseUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-surface-600 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:bg-surface-800"
          >
            <ExternalLink size={13} />
            Get v{latestVersion} from the release page instead
          </a>
        </>
      )
    case 'idle':
      return (
        <button
          onClick={onDownload}
          className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 py-2.5 text-xs font-semibold text-emerald-400 transition hover:bg-emerald-500/25"
        >
          <Download size={13} />
          Download and install v{latestVersion}
        </button>
      )
    default: {
      const exhaustive: never = download.status
      return exhaustive
    }
  }
}
