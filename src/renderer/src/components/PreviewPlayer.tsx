import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Play, Pause, RotateCcw } from 'lucide-react'
import type { Clip, Project, WatermarkPosition } from '@shared/types'
import { hexToRgba, resolveCaptionStyle } from '@shared/captionStyles'
import { groupWords, wordsInRange } from '@shared/captionLayout'
import { computeKeptSegments, TimeMap } from '@shared/tighten'
import { computeZoomEvents } from '@shared/zoom'
import { formatTimecode } from '../lib/format'
import {
  smoothPlaybackTime,
  type PlaybackClock,
  type PreviewFramePlan
} from '@shared/previewFrame'
import { applyPreviewVideoFrame } from '../lib/previewVideo'
import { usePreviewBus } from '../lib/previewBus'
import { useStore } from '../store'

/**
 * Live preview that mimics the exported result: bounded playback of the clip
 * range, CSS-simulated reframing (crop focus on the video, zoom on a wrapper
 * — same order as ffmpeg) and word-level karaoke captions from the transcript.
 */
export default function PreviewPlayer({
  project,
  clip
}: {
  project: Project
  clip: Clip
}): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const zoomLayerRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)
  const playbackClockRef = useRef<PlaybackClock>({ mediaTime: 0, wallAt: 0 })
  const previewPlanRef = useRef<PreviewFramePlan>({
    zoomEvents: null,
    focusTrack: null,
    framing: 'manual',
    manualFocusX: 0.5,
    isCrop: false
  })
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

  const applyFrame = useCallback((t: number): void => {
    const video = videoRef.current
    const layer = zoomLayerRef.current
    if (!video || !layer) return
    applyPreviewVideoFrame(video, layer, previewPlanRef.current, t)
  }, [])

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
      playbackClockRef.current = { mediaTime: t, wallAt: performance.now() }
      applyFrame(t)
      setTime(t)
    },
    [setTime, applyFrame]
  )

  const handleSeeked = useCallback((): void => {
    const video = videoRef.current
    const target = pendingSeekRef.current
    pendingSeekRef.current = null
    if (video && target !== null && Math.abs(video.currentTime - target) > 0.05) {
      video.currentTime = target
    }
    if (video) {
      playbackClockRef.current = { mediaTime: video.currentTime, wallAt: performance.now() }
      applyFrame(video.currentTime)
    }
  }, [applyFrame])

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

  // Mirrors the export's auto-zoom plan (same shared generator).
  const zoomEvents = useMemo(() => {
    if (!clip.edit.autoZoom) return null
    const events = computeZoomEvents(project.transcript, start, end, keptSegments)
    return events.length > 0 ? events : null
  }, [clip.edit.autoZoom, project.transcript, start, end, keptSegments])

  const src = window.clipforge.mediaUrl(project.video.path)
  const isCrop = clip.edit.aspect !== 'original' && clip.edit.reframeMode === 'crop'
  const isFitBlur = clip.edit.aspect !== 'original' && clip.edit.reframeMode === 'fit-blur'

  useEffect(() => {
    previewPlanRef.current = {
      zoomEvents,
      focusTrack: clip.focusTrack,
      framing: clip.edit.framing,
      manualFocusX: clip.edit.focusX,
      isCrop
    }
    const t = videoRef.current?.currentTime ?? start
    applyFrame(t)
  }, [
    zoomEvents,
    clip.focusTrack,
    clip.edit.framing,
    clip.edit.focusX,
    isCrop,
    applyFrame,
    start
  ])

  useEffect(() => {
    const tick = (): void => {
      const video = videoRef.current
      // While a seek is in flight, leave the element alone: issuing more
      // seeks (loop reset / tighten skip) before `seeked` fires is what
      // caused the stutter-then-freeze after edits.
      if (video && !video.seeking && pendingSeekRef.current === null) {
        if (video.currentTime >= end) {
          video.currentTime = start
          playbackClockRef.current = { mediaTime: start, wallAt: performance.now() }
        } else if (timeMap && !video.paused && timeMap.isRemoved(video.currentTime)) {
          const next = timeMap.nextKeptStart(video.currentTime)
          video.currentTime = next ?? end
          playbackClockRef.current = { mediaTime: video.currentTime, wallAt: performance.now() }
        }
        const smoothed = smoothPlaybackTime(video, playbackClockRef.current)
        playbackClockRef.current = smoothed.clock
        applyFrame(smoothed.t)
        setTime(smoothed.t)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    if (playing) rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing, start, end, timeMap, setTime, applyFrame])

  const togglePlay = (): void => {
    const video = videoRef.current
    if (!video) return
    if (playing) {
      video.pause()
      playbackClockRef.current = { mediaTime: video.currentTime, wallAt: 0 }
      setPlaying(false)
    } else {
      if (video.currentTime >= end - 0.05) requestSeek(start)
      playbackClockRef.current = { mediaTime: video.currentTime, wallAt: performance.now() }
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
        <div ref={zoomLayerRef} className="absolute inset-0 will-change-transform">
          <video
            ref={videoRef}
            src={src}
            poster={clip.thumbnailPath ? window.clipforge.mediaUrl(clip.thumbnailPath) : undefined}
            className="h-full w-full"
            style={{ objectFit: isCrop ? 'cover' : 'contain' }}
            onClick={togglePlay}
            onEnded={() => setPlaying(false)}
            onSeeked={handleSeeked}
            preload="auto"
          />
        </div>
        <BrollOverlay clip={clip} time={time} />
        <WatermarkOverlay />
        {clip.edit.captionsEnabled && project.transcript && (
          <CaptionOverlay
            transcript={project.transcript}
            clip={clip}
            time={time}
          />
        )}
        {clip.edit.showTitle && (clip.hook || clip.title) && time - start < Math.min(4, duration) && (
          <HookOverlay clip={clip} />
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

/**
 * Hook "card" shown for the first seconds of the clip. Mirrors the ASS Title
 * style burned in on export (`captions.ts`): a filled translucent label at the
 * top with a soft shadow, in the clip's caption font, so the preview matches
 * the render.
 */
function HookOverlay({ clip }: { clip: Clip }): React.JSX.Element {
  const brandColors = useStore((s) => s.settings?.branding.colors)
  const style = resolveCaptionStyle(
    clip.edit.captionStyleId,
    brandColors,
    clip.edit.captionFontFamily
  )
  const hookTextColor = brandColors?.enabled ? brandColors.hookTextColor : '#FFFFFF'
  const hookBackgroundColor = brandColors?.enabled
    ? hexToRgba(brandColors.hookBackgroundColor, 0.75)
    : 'rgba(0,0,0,0.75)'
  return (
    <div
      className="pointer-events-none absolute inset-x-0 flex justify-center px-[6cqw]"
      style={{ top: '7cqh' }}
    >
      <span
        className="hook-in inline-block max-w-[80cqw] text-center"
        style={{
          fontFamily: `'${style.fontFamily}', sans-serif`,
          fontWeight: 700,
          fontSize: '4.4cqh',
          lineHeight: 1.2,
          color: hookTextColor,
          padding: '0.7cqh 1.4cqh',
          borderRadius: '0.8cqh',
          backgroundColor: hookBackgroundColor,
          boxShadow: '0 0.4cqh 1.4cqh rgba(0,0,0,0.45)',
          textWrap: 'balance'
        }}
      >
        {clip.hook || clip.title}
      </span>
    </div>
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
  const brandColors = useStore((s) => s.settings?.branding.colors)
  const style = resolveCaptionStyle(
    clip.edit.captionStyleId,
    brandColors,
    clip.edit.captionFontFamily
  )

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
          fontFamily: `'${style.fontFamily}', sans-serif`,
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
