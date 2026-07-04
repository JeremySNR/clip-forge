import { useCallback, useRef } from 'react'
import { formatTimecode } from '../lib/format'

/**
 * Dual-handle trim control. Shows the clip range inside a context window that
 * extends a little beyond the AI-suggested boundaries so users can grab more
 * of the source video.
 */
export default function TrimBar({
  windowStart,
  windowEnd,
  start,
  end,
  onChange,
  onCommit
}: {
  windowStart: number
  windowEnd: number
  start: number
  end: number
  onChange: (start: number, end: number) => void
  onCommit: () => void
}): React.JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null)
  const windowDur = Math.max(0.1, windowEnd - windowStart)

  const toFrac = (t: number): number => (t - windowStart) / windowDur
  const fromClientX = useCallback(
    (clientX: number): number => {
      const rect = trackRef.current?.getBoundingClientRect()
      if (!rect || rect.width === 0) return windowStart
      const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      return windowStart + frac * windowDur
    },
    [windowStart, windowDur]
  )

  const beginDrag = (which: 'start' | 'end') => (e: React.PointerEvent) => {
    e.preventDefault()
    const MIN_LEN = 2
    const move = (ev: PointerEvent): void => {
      const t = fromClientX(ev.clientX)
      if (which === 'start') onChange(Math.min(t, end - MIN_LEN), end)
      else onChange(start, Math.max(t, start + MIN_LEN))
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      onCommit()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const leftPct = toFrac(start) * 100
  const rightPct = toFrac(end) * 100

  return (
    <div>
      <div ref={trackRef} className="relative h-9 cursor-pointer rounded-lg bg-surface-800">
        <div
          className="absolute inset-y-0 rounded-md border-y-2 border-accent-500 bg-accent-500/20"
          style={{ left: `${leftPct}%`, width: `${rightPct - leftPct}%` }}
        />
        <div
          className="absolute inset-y-0 w-3 cursor-ew-resize rounded-l-md bg-accent-500"
          style={{ left: `calc(${leftPct}% - 0px)` }}
          onPointerDown={beginDrag('start')}
        >
          <div className="absolute left-1/2 top-1/2 h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-white/80" />
        </div>
        <div
          className="absolute inset-y-0 w-3 cursor-ew-resize rounded-r-md bg-accent-500"
          style={{ left: `calc(${rightPct}% - 12px)` }}
          onPointerDown={beginDrag('end')}
        >
          <div className="absolute left-1/2 top-1/2 h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-white/80" />
        </div>
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-zinc-500">
        <span>In {formatTimecode(start)}</span>
        <span className="font-medium text-zinc-400">{formatTimecode(end - start)} long</span>
        <span>Out {formatTimecode(end)}</span>
      </div>
    </div>
  )
}
