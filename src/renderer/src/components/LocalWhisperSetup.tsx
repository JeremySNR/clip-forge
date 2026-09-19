import { useEffect, useState } from 'react'
import type { ImportProgress } from '@shared/types'

export default function LocalWhisperSetup({ pythonPath, onConfigured }: {
  pythonPath: string
  onConfigured: (pythonPath: string, modelPath: string) => void
}): React.JSX.Element {
  const [model, setModel] = useState<'small' | 'large-v3'>('small')
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [savedInstall, setSavedInstall] = useState<'checking' | 'ready' | 'missing' | 'error'>('checking')

  useEffect(() => window.cutawan.onLocalWhisperInstallProgress(setProgress), [])
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const settings = await window.cutawan.getSettings()
        if (!settings.subscription.whisperModelPath) {
          if (active) setSavedInstall('missing')
          return
        }
        await window.cutawan.checkLocalWhisperSetup()
        if (active) setSavedInstall('ready')
      } catch (error) {
        if (active) {
          setSavedInstall('error')
          setMessage(`Saved Whisper setup needs attention: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    })()
    return () => { active = false }
  }, [])

  const install = async (): Promise<void> => {
    setBusy(true)
    setMessage('')
    setSavedInstall('checking')
    setProgress({ progress: 0, message: 'Starting local setup…' })
    try {
      const result = await window.cutawan.installLocalWhisper(model, pythonPath)
      onConfigured(result.pythonPath, result.modelPath)
      setSavedInstall('ready')
      setMessage('Whisper is installed and ready. Transcription will run on this computer.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return <div className="rounded-xl border border-surface-600 bg-surface-850 p-4">
    <h3 className="text-sm font-semibold">Local Whisper</h3>
    {savedInstall === 'checking' && !busy && <p role="status" className="mt-2 text-xs text-zinc-400">Checking for an existing installation…</p>}
    {savedInstall === 'ready' && <p role="status" className="mt-2 text-xs text-emerald-400">Installed and ready on this computer. You do not need to download it again.</p>}
    <p className="mt-1 text-xs leading-relaxed text-zinc-400">
      Requires Python 3.10+ already installed. This creates a private environment in Cutawan’s app data,
      installs faster-whisper, and downloads a model from Hugging Face. Nothing is downloaded until you click Install.
    </p>
    <label className="mt-3 block text-xs" htmlFor="whisper-install-model">Speech model</label>
    <select id="whisper-install-model" value={model} onChange={e => setModel(e.target.value as typeof model)}
      disabled={busy} className="mt-1 w-full rounded-lg border border-surface-600 bg-surface-900 px-3 py-2 text-sm">
      <option value="small">Small — faster, lighter download</option>
      <option value="large-v3">Large v3 — higher accuracy, multi-GB download</option>
    </select>
    <div className="mt-3 flex gap-2">
      <button type="button" onClick={() => void install()} disabled={busy}
        className="rounded-lg bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 disabled:opacity-50">
        {busy ? 'Installing…' : savedInstall === 'ready' ? 'Reinstall or change model' : 'Install local Whisper'}
      </button>
      {busy && <button type="button" onClick={() => void window.cutawan.cancelLocalWhisperInstall()}
        className="rounded-lg border border-surface-600 px-3 py-2 text-sm">Cancel</button>}
    </div>
    {progress && <p role="status" className="mt-2 text-xs text-zinc-400">
      {progress.progress >= 0 ? `${Math.round(progress.progress * 100)}% · ` : ''}{progress.message}
    </p>}
    {message && <p role="status" className="mt-2 text-xs text-zinc-300">{message}</p>}
  </div>
}
