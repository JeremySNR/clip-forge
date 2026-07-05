import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Play, Pause, RotateCcw } from 'lucide-react'
import type { Clip, Project, WatermarkPosition } from '@shared/types'
import { getCaptionStyle } from '@shared/captionStyles'
import { groupWords, wordsInRange } from '@shared/captionLayout'
import { computeKeptSegments, TimeMap } from '@shared/tighten'
import { computeZoomEvents, remapZoomEvents, zoomAt } from '@shared/zoom'
import { focusAt } from '@shared/focusTrack'
import { formatTimecode } from '../lib/format'
import { usePreviewBus } from '../lib/previewBus'
import { useStore } from '../store'

/**
 * Live preview that mimics the exported result: bounded playback of the clip
 * range, CSS-simulated reframing (object-position matches the ffmpeg crop
 * focus) and word-level karaoke captions rendered from the transcript.
 */
export default function PreviewPlayer({
  project,
  clip
}: {
  project: Project
  clip: Clip
}): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const rafRef = useRef<number>(0)
  /**
   * Seek requests issued while the browser is still completing a previous
   * seek are coalesced here and flushed on `seeked`. Setting currentTime on
   * every pointermove/rAF frame queues seeks faster than the demuxer can
   * serve them, which made scrubbing sluggish and could wedge the element in
   * a permanent `seeking` state (playback "randomly stopping").
   */
  const pendingSeekRef = useRef<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTimeState] = useState(clip.edit.start)
  const setBusTime = usePreviewBus((s) => s.setTime)
  const setSeekHandler = usePreviewBus((s) => s.setSeekHandler)

  const setTime = useCallback(
    (t: number): void => {
      setTimeState(t)
      setBusTime(t)
    },
    [setBusTime]
  )

  const requestSeek = useCallback(
    (t: number): void => {
      const video = videoRef.current
      if (!video) return
      if (video.seeking) {
        pendingSeekRef.current = t
      } else {
        pendingSeekRef.current = null
        video.currentTime = t
      }
      setTime(t)
    },
    [setTime]
  )

  const handleSeeked = useCallback((): void => {
    const video = videoRef.current
    const target = pendingSeekRef.current
    pendingSeekRef.current = null
    if (video && target !== null && Math.abs(video.currentTime - target) > 0.05) {
      video.currentTime = target
    }
  }, [])

  const { start, end } = clip.edit
  const duration = Math.max(0.1, end - start)

  const aspectStyle = useMemo(() => {
    switch (clip.edit.aspect) {
      case '9:16':
        return 9 / 16
      case '1:1':
        return 1
      case '16:9':
        return 16 / 9
      case 'original':
        return project.video.width / Math.max(1, project.video.height)
      default: {
        const exhaustive: never = clip.edit.aspect
        return exhaustive
      }
    }
  }, [clip.edit.aspect, project.video.width, project.video.height])

  // Keep playback inside [start, end].
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (video.currentTime < start - 0.05 || video.currentTime > end + 0.05) {
      requestSeek(start)
    }
  }, [start, end, requestSeek])

  // Let the sidebar (timeline, transcript) seek the preview.
  useEffect(() => {
    setSeekHandler((t: number) => {
      requestSeek(Math.max(start, Math.min(end, t)))
    })
    return () => setSeekHandler(null)
  }, [start, end, setSeekHandler, requestSeek])

  // Mirrors the export's tighten-cuts behaviour by skipping removed spans.
  const keptSegments = useMemo(() => {
    if (!clip.edit.tightenCuts || !project.transcript) return null
    return computeKeptSegments(project.transcript, start, end)
  }, [clip.edit.tightenCuts, project.transcript, start, end])
  const timeMap = useMemo(() => (keptSegments ? new TimeMap(keptSegments) : null), [keptSegments])

  // Mirrors the export's auto-zoom plan (same shared generator and timeline).
  const zoomEvents = useMemo(() => {
    if (!clip.edit.autoZoom) return null
    const planned = computeZoomEvents(project.transcript, start, end, keptSegments)
    const events = remapZoomEvents(planned, (t) => (timeMap ? timeMap.toOutput(t) : t - start))
    return events.length > 0 ? events : null
  }, [clip.edit.autoZoom, project.transcript, start, end, keptSegments, timeMap])
  const zoomTime = timeMap ? timeMap.toOutput(time) : time - start
  const zoom = zoomEvents ? zoomAt(zoomEvents, zoomTime) : 1

  useEffect(() => {
    const tick = (): void => {
      const video = videoRef.current
      // While a seek is in flight, leave the element alone: issuing more
      // seeks (loop reset / tighten skip) before `seeked` fires is what
      // caused the stutter-then-freeze after edits.
      if (video && !video.seeking && pendingSeekRef.current === null) {
        if (video.currentTime >= end) {
          video.currentTime = start
        } else if (timeMap && !video.paused && timeMap.isRemoved(video.currentTime)) {
          const next = timeMap.nextKeptStart(video.currentTime)
          video.currentTime = next ?? end
        }
        setTime(video.currentTime)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    if (playing) rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing, start, end, timeMap, setTime])

  const togglePlay = (): void => {
    const video = videoRef.current
    if (!video) return
    if (playing) {
      video.pause()
      setPlaying(false)
    } else {
      if (video.currentTime >= end - 0.05) requestSeek(start)
      void video.play()
      setPlaying(true)
    }
  }

  const restart = (): void => {
    requestSeek(start)
  }

  const seek = (fraction: number): void => {
    requestSeek(start + fraction * duration)
  }

  const src = window.clipforge.mediaUrl(project.video.path)
  const isCrop = clip.edit.aspect !== 'original' && clip.edit.reframeMode === 'crop'
  const isFitBlur = clip.edit.aspect !== 'original' && clip.edit.reframeMode === 'fit-blur'
  const previewFocusX =
    clip.edit.framing === 'auto' && clip.focusTrack
      ? focusAt(clip.focusTrack, time)
      : clip.edit.focusX

  return (
    <div className="flex h-full min-h-0 flex-col items-center gap-3">
      <div
        className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-surface-700 bg-black"
        style={{ aspectRatio: String(aspectStyle), containerType: 'size', maxWidth: '100%' }}
      >
        {isFitBlur && clip.thumbnailPath && (
          <img
            src={window.clipforge.mediaUrl(clip.thumbnailPath)}
            alt=""
            className="absolute inset-0 h-full w-full scale-110 object-cover opacity-70 blur-2xl brightness-75"
          />
        )}
        <video
          ref={videoRef}
          src={src}
          poster={clip.thumbnailPath ? window.clipforge.mediaUrl(clip.thumbnailPath) : undefined}
          className="relative h-full w-full"
          style={{
            objectFit: isCrop ? 'cover' : 'contain',
            objectPosition: isCrop ? `${previewFocusX * 100}% 50%` : '50% 50%',
            // Auto zoom, anchored where faces sit in vertical framing.
            transform: zoom > 1.0001 ? `scale(${zoom.toFixed(4)})` : undefined,
            transformOrigin: '50% 42%'
          }}
          onClick={togglePlay}
          onEnded={() => setPlaying(false)}
          onSeeked={handleSeeked}
          preload="auto"
        />
        <BrollOverlay clip={clip} time={time} />
        <WatermarkOverlay />
        {clip.edit.captionsEnabled && project.transcript && (
          <CaptionOverlay
            transcript={project.transcript}
            clip={clip}
            time={time}
          />
        )}
        {clip.edit.showTitle && time - start < Math.min(4, duration) && (
          <div
            className="pointer-events-none absolute inset-x-0 flex justify-center px-[6cqw] text-center"
            style={{ top: '7cqh' }}
          >
            <span
              className="font-extrabold text-white"
              style={{
                fontSize: '3.6cqh',
                textShadow: '0 0 6px rgba(0,0,0,0.9), 2px 2px 0 rgba(0,0,0,0.8)'
              }}
            >
              {clip.hook || clip.title}
            </span>
          </div>
        )}
        {!playing && (
          <button
            onClick={togglePlay}
            className="absolute inset-0 flex items-center justify-center bg-black/25 transition hover:bg-black/35"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/95 shadow-xl">
              <Play size={22} className="ml-1 text-black" />
            </span>
          </button>
        )}
      </div>

      <div className="flex w-full max-w-md items-center gap-3">
        <button
          onClick={togglePlay}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-800 text-zinc-200 transition hover:bg-surface-700"
        >
          {playing ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
        </button>
        <button
          onClick={restart}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-800 text-zinc-400 transition hover:bg-surface-700"
        >
          <RotateCcw size={14} />
        </button>
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(((time - start) / duration) * 1000)}
          onChange={(e) => seek(Number(e.target.value) / 1000)}
          className="flex-1"
        />
        <span className="shrink-0 text-xs tabular-nums text-zinc-500">
          {formatTimecode(Math.max(0, time - start))} / {formatTimecode(duration)}
        </span>
      </div>
    </div>
  )
}

/** Mirrors the export's branding watermark (same corner, size and opacity). */
function WatermarkOverlay(): React.JSX.Element | null {
  const branding = useStore((s) => s.settings?.branding)
  if (!branding?.enabled || !branding.imagePath) return null
  const margin = '3cqw'
  const corner: Record<WatermarkPosition, React.CSSProperties> = {
    'top-left': { top: margin, left: margin },
    'top-right': { top: margin, right: margin },
    'bottom-left': { bottom: margin, left: margin },
    'bottom-right': { bottom: margin, right: margin }
  }
  return (
    <img
      src={window.clipforge.mediaUrl(branding.imagePath)}
      alt=""
      className="pointer-events-none absolute"
      style={{
        width: `${Math.min(0.5, Math.max(0.04, branding.scale)) * 100}cqw`,
        opacity: Math.min(1, Math.max(0.05, branding.opacity)),
        ...corner[branding.position]
      }}
    />
  )
}

function BrollOverlay({ clip, time }: { clip: Clip; time: number }): React.JSX.Element | null {
  const active = clip.broll.find(
    (b) => b.enabled && b.imagePath && time >= b.start && time <= b.end
  )
  if (!active) return null
  const src = window.clipforge.mediaUrl(active.imagePath!)
  if (active.mode === 'fullscreen') {
    return (
      <img
        src={src}
        alt={active.trigger}
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
      />
    )
  }
  return (
    <div
      className="pointer-events-none absolute inset-x-0 flex justify-center"
      style={{ top: '10cqh' }}
    >
      <img
        src={src}
        alt={active.trigger}
        className="border-4 border-white shadow-2xl"
        style={{ width: '62%', height: 'auto' }}
      />
    </div>
  )
}

function CaptionOverlay({
  transcript,
  clip,
  time
}: {
  transcript: NonNullable<Project['transcript']>
  clip: Clip
  time: number
}): React.JSX.Element | null {
  const style = getCaptionStyle(clip.edit.captionStyleId)

  const groups = useMemo(() => {
    const words = wordsInRange(transcript, clip.edit.start, clip.edit.end)
    return groupWords(words, style.wordsPerGroup)
  }, [transcript, clip.edit.start, clip.edit.end, style.wordsPerGroup])

  const group = groups.find((g) => time >= g.start && time <= g.end + 0.05)
  if (!group) return null

  let activeIdx = -1
  for (let i = 0; i < group.words.length; i++) {
    if (time >= group.words[i].start) activeIdx = i
  }

  return (
    <div
      className="pointer-events-none absolute inset-x-0 flex justify-center px-[5cqw] text-center"
      style={{ top: `${style.positionY * 100}cqh`, transform: 'translateY(-50%)' }}
    >
      <div
        style={{
          fontFamily: `'${clip.edit.captionFontFamily ?? style.fontFamily}', sans-serif`,
          fontSize: `${style.fontScale * 100}cqh`,
          fontWeight: style.bold ? 700 : 400,
          lineHeight: 1.25,
          textShadow:
            style.outlineWidth > 0
              ? `0 0 ${style.outlineWidth * 2}px ${style.outlineColor}, 2px 2px ${style.outlineWidth}px ${style.outlineColor}, -2px 2px ${style.outlineWidth}px ${style.outlineColor}, 2px -2px ${style.outlineWidth}px ${style.outlineColor}, -2px -2px ${style.outlineWidth}px ${style.outlineColor}`
              : 'none'
        }}
      >
        {group.words.map((w, i) => {
          const active = i === activeIdx
          const text = style.uppercase ? w.text.toUpperCase() : w.text
          return (
            <span
              key={`${w.start}-${i}`}
              className={active ? 'caption-pop inline-block' : 'inline-block'}
              style={{
                color: active ? style.highlightColor : style.textColor,
                backgroundColor: active && style.highlightBoxColor ? style.highlightBoxColor : 'transparent',
                borderRadius: style.highlightBoxColor ? '0.35em' : undefined,
                padding: style.highlightBoxColor ? '0 0.18em' : undefined,
                marginRight: '0.28em'
              }}
            >
              {text}
            </span>
          )
        })}
      </div>
    </div>
  )
}
