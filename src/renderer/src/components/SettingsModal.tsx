import { useState } from 'react'
import { X, KeyRound, Brain, Check, ExternalLink } from 'lucide-react'
import { useStore } from '../store'

const ANALYSIS_MODELS = ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1']

export default function SettingsModal(): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const saveSettings = useStore((s) => s.saveSettings)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(settings?.analysisModel ?? 'gpt-4o-mini')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={() => setSettingsOpen(false)}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-surface-700 bg-surface-900 p-6 shadow-2xl"
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
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={settings?.hasApiKey ? `Current: ${settings.apiKeyMasked}` : 'sk-…'}
            className="mt-2.5 w-full rounded-xl border border-surface-600 bg-surface-850 px-3.5 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-accent-500 focus:outline-none"
          />
          <a
            href="https://platform.openai.com/api-keys"
            target="_blank"
            rel="noreferrer"
            className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-accent-400 hover:underline"
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
                    ? 'border-accent-500 bg-accent-500/10 text-zinc-100'
                    : 'border-surface-600 text-zinc-400 hover:bg-surface-800'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={() => void save()}
          disabled={saving}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-500 disabled:opacity-60"
        >
          {saved ? <Check size={16} /> : null}
          {saved ? 'Saved' : saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </div>
  )
}
