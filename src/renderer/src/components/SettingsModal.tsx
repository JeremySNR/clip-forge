import { useEffect, useState } from 'react'
import {
  X,
  KeyRound,
  Brain,
  Check,
  ExternalLink,
  MonitorPlay,
  Zap,
  Download,
  Loader2
} from 'lucide-react'
import { useStore } from '../store'
import type { EncoderPreference, ImportProgress, QualityPreference } from '@shared/types'

const ANALYSIS_MODELS = ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1']

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

export default function SettingsModal(): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const saveSettings = useStore((s) => s.saveSettings)
  const refreshSettings = useStore((s) => s.refreshSettings)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(settings?.analysisModel ?? 'gpt-4o-mini')
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
            gpt-4o-mini is fast and cheap; larger models pick moments more carefully.
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
