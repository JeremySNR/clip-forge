import { HardDrive } from 'lucide-react'
import { useStore } from '../store'
import {
  MAX_SIZE_TARGET_MB,
  MIN_SIZE_TARGET_MB,
  normalizeSizeTargetMb
} from '@shared/uploadBudget'

/** Common upload ceilings: Discord (8/10), email, WhatsApp-ish, Nitro, generous. */
const SIZE_PRESETS_MB = [8, 10, 25, 50, 100]

/**
 * Fit-under-N-MB export control. The byte cap lives in Settings (same as
 * quality/encoder) so Export all and the editor share it. `compact` is the
 * editor sticky footer; the full layout lives on the Settings export tab.
 */
export default function SizeTargetControls({
  compact = false
}: {
  compact?: boolean
}): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const saveSettings = useStore((s) => s.saveSettings)
  const enabled = settings?.sizeTargetMb != null
  const mb = settings?.sizeTargetMb ?? 25

  const setEnabled = (on: boolean): void => {
    void saveSettings({ sizeTargetMb: on ? mb : null })
  }
  const setMb = (value: number): void => {
    const next = normalizeSizeTargetMb(value)
    if (next === null) return
    void saveSettings({ sizeTargetMb: next })
  }

  if (compact) {
    return (
      <div data-testid="export-size-limit" className="mb-3">
        <button
          type="button"
          onClick={() => setEnabled(!enabled)}
          className="flex w-full items-center justify-between gap-3 rounded-lg border border-surface-600 px-3 py-2.5 text-left text-xs font-medium text-zinc-300 transition hover:bg-surface-800"
        >
          Fit under a size limit
          <span
            className={`relative h-5 w-9 shrink-0 rounded-full transition ${enabled ? 'bg-zinc-100' : 'bg-surface-600'}`}
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${enabled ? 'left-[18px] bg-zinc-900' : 'left-0.5 bg-white'}`}
            />
          </span>
        </button>
        {enabled && (
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              min={MIN_SIZE_TARGET_MB}
              max={MAX_SIZE_TARGET_MB}
              step={1}
              value={mb}
              onChange={(e) => setMb(Number(e.target.value))}
              className="w-20 rounded-lg border border-surface-600 bg-surface-850 px-2.5 py-1.5 text-xs tabular-nums text-zinc-200 focus:border-white/25 focus:outline-none"
            />
            <span className="text-[11px] text-zinc-500">MB</span>
            <div className="flex flex-1 flex-wrap gap-1">
              {SIZE_PRESETS_MB.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setMb(preset)}
                  className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition ${
                    mb === preset
                      ? 'border-white/30 bg-white/[0.07] text-zinc-200'
                      : 'border-surface-600 text-zinc-500 hover:bg-surface-800'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="mt-5" data-testid="export-size-limit">
      <label className="flex items-center gap-2 text-sm font-medium">
        <HardDrive size={15} className="text-accent-400" />
        Fit under a size limit
      </label>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
        Encode once to land under a megabyte cap — Discord, email, WhatsApp, and anywhere that
        rejects large files. Quality and GPU encoder are ignored while this is on: the cap
        decides the bitrate, on CPU.
      </p>
      <button
        type="button"
        onClick={() => setEnabled(!enabled)}
        className="mt-2.5 flex w-full items-center justify-between gap-3 rounded-lg border border-surface-600 px-3 py-2.5 text-left text-xs font-medium text-zinc-300 transition hover:bg-surface-800"
      >
        Limit export size
        <span
          className={`relative h-5 w-9 shrink-0 rounded-full transition ${enabled ? 'bg-zinc-100' : 'bg-surface-600'}`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${enabled ? 'left-[18px] bg-zinc-900' : 'left-0.5 bg-white'}`}
          />
        </span>
      </button>
      {enabled && (
        <>
          <div className="mt-2.5 flex items-center gap-2">
            <input
              type="number"
              min={MIN_SIZE_TARGET_MB}
              max={MAX_SIZE_TARGET_MB}
              step={1}
              value={mb}
              onChange={(e) => setMb(Number(e.target.value))}
              className="w-24 rounded-xl border border-surface-600 bg-surface-850 px-3 py-2 text-sm tabular-nums text-zinc-200 focus:border-white/25 focus:outline-none"
            />
            <span className="text-xs text-zinc-500">MB</span>
          </div>
          <div className="mt-2 grid grid-cols-5 gap-1.5">
            {SIZE_PRESETS_MB.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setMb(preset)}
                className={`rounded-lg border px-2 py-1.5 text-center text-[11px] font-medium transition ${
                  mb === preset
                    ? 'border-white/30 bg-white/[0.07] text-zinc-100'
                    : 'border-surface-600 text-zinc-400 hover:bg-surface-800'
                }`}
              >
                {preset} MB
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
