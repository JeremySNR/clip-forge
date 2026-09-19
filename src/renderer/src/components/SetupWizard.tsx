import { useState } from 'react'
import { DEFAULT_SUBSCRIPTION, type SubscriptionSettings } from '@shared/subscription'
import { useStore } from '../store'
import LocalWhisperSetup from './LocalWhisperSetup'

type Route = 'api' | 'chatgpt' | 'local' | 'claude'

export default function SetupWizard(): React.JSX.Element {
  const settings = useStore(s => s.settings)
  const saveSettings = useStore(s => s.saveSettings)
  const [route, setRoute] = useState<Route | null>(null)
  const [subscription, setSubscription] = useState<SubscriptionSettings>(settings?.subscription ?? DEFAULT_SUBSCRIPTION)
  const [apiKey, setApiKey] = useState('')
  const [verified, setVerified] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const updateSubscription = (patch: Partial<SubscriptionSettings>): void => {
    setSubscription(current => ({ ...current, ...patch }))
    setVerified(false)
    setMessage('')
  }
  const check = async (): Promise<void> => {
    setBusy(true)
    setMessage('')
    try {
      await saveSettings({ subscription: { ...subscription, provider: 'chatgpt' } })
      const result = await window.cutawan.checkSubscriptionSetup()
      setVerified(true)
      setMessage(result.message)
    } catch (error) {
      setVerified(false)
      setMessage(error instanceof Error ? error.message : String(error))
    } finally { setBusy(false) }
  }
  const checkLocal = async (): Promise<void> => {
    setBusy(true)
    setMessage('')
    try {
      await saveSettings({ subscription: { ...subscription, provider: 'api', localTranscription: true } })
      const result = await window.cutawan.checkLocalWhisperSetup()
      setVerified(true)
      setMessage(result.message)
    } catch (error) {
      setVerified(false)
      setMessage(error instanceof Error ? error.message : String(error))
    } finally { setBusy(false) }
  }
  const finish = async (skip = false): Promise<void> => {
    setBusy(true)
    setMessage('')
    try {
      await saveSettings({
        setupComplete: true,
        ...(skip ? {} : route === 'chatgpt'
          ? { subscription: { ...subscription, provider: 'chatgpt' as const } }
          : route === 'local'
            ? { subscription: { ...subscription, provider: 'api' as const, localTranscription: true } }
          : { subscription: { ...subscription, provider: 'api' as const }, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) })
      })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally { setBusy(false) }
  }

  return <div className="fixed inset-0 z-[60] overflow-y-auto px-5 py-10 text-zinc-100" style={{ backgroundColor: '#09090b' }}>
    <div className="mx-auto max-w-2xl rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl shadow-black/70 sm:p-8">
      <div className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-400">Welcome to Cutawan</p>
        <h1 className="mt-2 text-3xl font-bold">Choose how your clips get made</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          Pick an AI connection for clip finding. You can change it later in Settings. Video editing and export stay on your computer.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" onClick={() => { setRoute('chatgpt'); setVerified(false); setMessage('') }}
          className={`rounded-xl border p-4 text-left ${route === 'chatgpt' ? 'border-accent-400 bg-accent-400/10' : 'border-surface-600 bg-surface-900 hover:border-zinc-500'}`}>
          <span className="block text-sm font-semibold">ChatGPT sign-in</span>
          <span className="mt-2 block text-xs leading-relaxed text-zinc-400">Use Codex for analysis and local Whisper for speech. No OpenAI API key.</span>
        </button>
        <button type="button" onClick={() => { setRoute('api'); setVerified(false); setMessage('') }}
          className={`rounded-xl border p-4 text-left ${route === 'api' ? 'border-accent-400 bg-accent-400/10' : 'border-surface-600 bg-surface-900 hover:border-zinc-500'}`}>
          <span className="block text-sm font-semibold">OpenAI-compatible API</span>
          <span className="mt-2 block text-xs leading-relaxed text-zinc-400">Use an API key and a supported endpoint. API usage is billed separately.</span>
        </button>
        <button type="button" onClick={() => { setRoute('local'); setMessage(''); setVerified(false) }}
          className={`rounded-xl border p-4 text-left ${route === 'local' ? 'border-accent-400 bg-accent-400/10' : 'border-surface-600 bg-surface-900 hover:border-zinc-500'}`}>
          <span className="block text-sm font-semibold">Local captions only</span>
          <span className="mt-2 block text-xs leading-relaxed text-zinc-400">Transcribe and caption full videos without an AI service. Clip finding needs a connection later.</span>
        </button>
        <button type="button" onClick={() => { setRoute('claude'); setVerified(false); setMessage('') }}
          className={`rounded-xl border p-4 text-left ${route === 'claude' ? 'border-amber-500/60 bg-amber-500/10' : 'border-surface-600 bg-surface-900 hover:border-zinc-500'}`}>
          <span className="block text-sm font-semibold">Claude subscription</span>
          <span className="mt-2 block text-xs leading-relaxed text-zinc-400">Not available for Cutawan; see why below.</span>
        </button>
      </div>

      {route === 'chatgpt' && <div className="mt-5 space-y-4 rounded-xl border border-surface-600 bg-surface-900 p-5">
        <div>
          <h2 className="text-base font-semibold">ChatGPT + local Whisper</h2>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
            Install the Codex CLI, run <code>codex login</code>, and choose ChatGPT sign-in.
            Your plan’s Codex allowance and limits apply. Cutawan never reads your login tokens or silently switches to paid API billing.
          </p>
          <a href="https://developers.openai.com/codex/cli" target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs underline">Codex install instructions ↗</a>
        </div>
        <label className="block text-xs">Codex executable
          <input value={subscription.codexPath} onChange={e => updateSubscription({ codexPath: e.target.value })}
            className="mt-1 w-full rounded-lg border border-surface-600 bg-surface-850 px-3 py-2 text-sm" />
        </label>
        <label className="block text-xs">Python executable (Python 3.10+)
          <input value={subscription.pythonPath} onChange={e => updateSubscription({ pythonPath: e.target.value })}
            className="mt-1 w-full rounded-lg border border-surface-600 bg-surface-850 px-3 py-2 text-sm" />
        </label>
        <LocalWhisperSetup pythonPath={subscription.pythonPath} onConfigured={(pythonPath, whisperModelPath) => updateSubscription({ pythonPath, whisperModelPath })} />
        <label className="block text-xs">Whisper model folder (if already installed)
          <input value={subscription.whisperModelPath} onChange={e => updateSubscription({ whisperModelPath: e.target.value })}
            placeholder="Folder containing model.bin" className="mt-1 w-full rounded-lg border border-surface-600 bg-surface-850 px-3 py-2 text-sm" />
        </label>
        <p className="text-xs text-zinc-500">Default: Luna, low reasoning, with a cap of 10 new requests per UTC day. A video may need more; adjust the cap in Settings. Checking makes no AI request.</p>
        <button type="button" onClick={() => void check()} disabled={busy}
          className="rounded-lg border border-surface-600 px-3 py-2 text-sm disabled:opacity-50">{busy ? 'Checking…' : 'Check connection and Whisper'}</button>
        {verified && <p className="text-xs text-emerald-400">Ready to start.</p>}
      </div>}

      {route === 'api' && <div className="mt-5 rounded-xl border border-surface-600 bg-surface-900 p-5">
        <h2 className="text-base font-semibold">API connection</h2>
        <p className="mt-1 text-xs leading-relaxed text-zinc-400">
          ChatGPT subscriptions do not include OpenAI API usage. This route uses separate API billing for transcription and analysis.
          You can set a different OpenAI-compatible endpoint in Settings later.
        </p>
        <label className="mt-4 block text-xs">OpenAI API key
          <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={settings?.hasApiKey ? 'Key already configured' : 'sk-…'}
            className="mt-1 w-full rounded-lg border border-surface-600 bg-surface-850 px-3 py-2 text-sm" />
        </label>
        <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs underline">Create an API key ↗</a>
        <label className="mt-5 flex items-center gap-2 text-xs text-zinc-300">
          <input type="checkbox" checked={subscription.localTranscription} onChange={e => updateSubscription({ localTranscription: e.target.checked })} />
          Transcribe speech locally instead of using the transcription API
        </label>
        {subscription.localTranscription && <div className="mt-4 space-y-3">
          <label className="block text-xs">Python executable (Python 3.10+)
            <input value={subscription.pythonPath} onChange={e => updateSubscription({ pythonPath: e.target.value })}
              className="mt-1 w-full rounded-lg border border-surface-600 bg-surface-850 px-3 py-2 text-sm" />
          </label>
          <LocalWhisperSetup pythonPath={subscription.pythonPath} onConfigured={(pythonPath, whisperModelPath) => updateSubscription({ pythonPath, whisperModelPath })} />
          <label className="block text-xs">Whisper model folder (if already installed)
            <input value={subscription.whisperModelPath} onChange={e => updateSubscription({ whisperModelPath: e.target.value })}
              placeholder="Folder containing model.bin" className="mt-1 w-full rounded-lg border border-surface-600 bg-surface-850 px-3 py-2 text-sm" />
          </label>
        </div>}
      </div>}

      {route === 'local' && <div className="mt-5 space-y-4 rounded-xl border border-surface-600 bg-surface-900 p-5">
        <div>
          <h2 className="text-base font-semibold">Local captions only</h2>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
            Caption a whole video, trim it, and export without an API key. This route does not find or score viral clips.
          </p>
        </div>
        <label className="block text-xs">Python executable (Python 3.10+)
          <input value={subscription.pythonPath} onChange={e => updateSubscription({ pythonPath: e.target.value })}
            className="mt-1 w-full rounded-lg border border-surface-600 bg-surface-850 px-3 py-2 text-sm" />
        </label>
        <LocalWhisperSetup pythonPath={subscription.pythonPath} onConfigured={(pythonPath, whisperModelPath) => updateSubscription({ pythonPath, whisperModelPath })} />
        <label className="block text-xs">Whisper model folder (if already installed)
          <input value={subscription.whisperModelPath} onChange={e => updateSubscription({ whisperModelPath: e.target.value })}
            placeholder="Folder containing model.bin" className="mt-1 w-full rounded-lg border border-surface-600 bg-surface-850 px-3 py-2 text-sm" />
        </label>
        <button type="button" onClick={() => void checkLocal()} disabled={busy}
          className="rounded-lg border border-surface-600 px-3 py-2 text-sm disabled:opacity-50">{busy ? 'Checking…' : 'Check local Whisper'}</button>
        {verified && <p className="text-xs text-emerald-400">Ready to caption videos locally.</p>}
      </div>}

      {route === 'claude' && <div className="mt-5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm">
        <h2 className="font-semibold">Claude subscriptions cannot be connected here</h2>
        <p className="mt-2 text-xs leading-relaxed text-zinc-300">
          Anthropic directs developers of third-party apps, including open-source apps, to use API-key authentication.
          Claude’s web or desktop login is not an API credential, and Cutawan will not route its automated requests through a personal subscription.
        </p>
        <a href="https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account" target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs underline">Anthropic’s guidance ↗</a>
      </div>}

      {message && <p role="status" className="mt-4 text-xs text-zinc-300">{message}</p>}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => void finish(true)} disabled={busy} className="text-xs text-zinc-400 underline disabled:opacity-50">Explore without setup</button>
        <button type="button" onClick={() => void finish()} disabled={busy || route === null || route === 'claude' || ((route === 'chatgpt' || route === 'local') && !verified) || (route === 'api' && !apiKey.trim() && !settings?.hasApiKey)}
          className="rounded-xl bg-zinc-100 px-5 py-2.5 text-sm font-semibold text-zinc-900 disabled:opacity-40">Start using Cutawan</button>
      </div>
    </div>
  </div>
}
