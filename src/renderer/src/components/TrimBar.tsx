import { useCallback, useRef } from 'react'
import type { TimelineData } from '@shared/types'
import { formatTimecode } from '../lib/format'
import { usePreviewBus } from '../lib/previewBus'

/**
 * Visual trim control: a filmstrip of the context window with the audio
 * waveform overlaid, dual drag handles bounding the clip, a live playhead,
 * and click-to-seek. The window extends a little beyond the AI-suggested
 * boundaries so users can grab more of the source video.
 */
export default function TrimBar({
  windowStart,
  windowEnd,
  start,
  end,
  timeline,
  onChange,
  onCommit
}: {
  windowStart: number
  windowEnd: number
  start: number
  end: number
  timeline: TimelineData | null
  onChange: (start: number, end: number) => void
  onCommit: () => void
}): React.JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null)
  const time = usePreviewBus((s) => s.time)
  const seek = usePreviewBus((s) => s.seek)
  const windowDur = Math.max(0.1, windowEnd - windowStart)

  const toFrac = (t: number): number => Math.max(0, Math.min(1, (t - windowStart) / windowDur))
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
    e.stopPropagation()
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
  const playheadPct = toFrac(time) * 100
  const waveform = timeline?.waveform ?? []

  return (
    <div>
      <div
        ref={trackRef}
        className="relative h-16 cursor-pointer overflow-hidden rounded-lg bg-surface-800"
        onPointerDown={(e) => seek(fromClientX(e.clientX))}
      >
        {/* Filmstrip */}
        {timeline && timeline.frames.length > 0 && (
          <div className="pointer-events-none absolute inset-0 flex">
            {timeline.frames.map((f) => (
              <img
                key={f}
                src={window.clipforge.mediaUrl(f)}
                alt=""
                draggable={false}
                className="h-full min-w-0 flex-1 object-cover"
              />
            ))}
          </div>
        )}
        {/* Waveform */}
        {waveform.length > 1 && (
          <svg
            className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 w-full"
            viewBox={`0 0 ${waveform.length} 1`}
            preserveAspectRatio="none"
          >
            <path
              d={`M0,1 ${waveform.map((v, i) => `L${i + 0.5},${(1 - v * 0.92).toFixed(3)}`).join(' ')} L${waveform.length},1 Z`}
              fill="rgba(255,255,255,0.5)"
            />
          </svg>
        )}
        {/* Dim outside the selection */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 bg-black/65"
          style={{ width: `${leftPct}%` }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 bg-black/65"
          style={{ width: `${100 - rightPct}%` }}
        />
        {/* Selection frame */}
        <div
          className="pointer-events-none absolute inset-y-0 border-y-2 border-zinc-100"
          style={{ left: `${leftPct}%`, width: `${rightPct - leftPct}%` }}
        />
        {/* Playhead: white core with a dark halo so it reads on bright frames */}
        {time >= windowStart && time <= windowEnd && (
          <div
            className="pointer-events-none absolute inset-y-0 w-[6px] -translate-x-1/2 bg-black/60"
            style={{ left: `${playheadPct}%` }}
          >
            <div className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-white" />
          </div>
        )}
        {/* Drag handles */}
        <div
          className="absolute inset-y-0 w-3 cursor-ew-resize rounded-l-md bg-zinc-100"
          style={{ left: `calc(${leftPct}% - 0px)` }}
          onPointerDown={beginDrag('start')}
        >
          <div className="absolute left-1/2 top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-zinc-600" />
        </div>
        <div
          className="absolute inset-y-0 w-3 cursor-ew-resize rounded-r-md bg-zinc-100"
          style={{ left: `calc(${rightPct}% - 12px)` }}
          onPointerDown={beginDrag('end')}
        >
          <div className="absolute left-1/2 top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-zinc-600" />
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
