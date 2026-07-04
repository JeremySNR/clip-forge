import { useEffect, useMemo, useRef, useState } from 'react'
import { Play, Pause, RotateCcw } from 'lucide-react'
import type { Clip, Project } from '@shared/types'
import { getCaptionStyle } from '@shared/captionStyles'
import { groupWords, wordsInRange } from '@shared/captionLayout'
import { computeKeptSegments, TimeMap } from '@shared/tighten'
import { focusAt } from '@shared/focusTrack'
import { formatTimecode } from '../lib/format'

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
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(clip.edit.start)

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
      video.currentTime = start
      setTime(start)
    }
  }, [start, end])

  // Mirrors the export's tighten-cuts behaviour by skipping removed spans.
  const timeMap = useMemo(() => {
    if (!clip.edit.tightenCuts || !project.transcript) return null
    const segments = computeKeptSegments(project.transcript, start, end)
    return segments ? new TimeMap(segments) : null
  }, [clip.edit.tightenCuts, project.transcript, start, end])

  useEffect(() => {
    const tick = (): void => {
      const video = videoRef.current
      if (video) {
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
  }, [playing, start, end, timeMap])

  const togglePlay = (): void => {
    const video = videoRef.current
    if (!video) return
    if (playing) {
      video.pause()
      setPlaying(false)
    } else {
      if (video.currentTime >= end - 0.05) video.currentTime = start
      void video.play()
      setPlaying(true)
    }
  }

  const restart = (): void => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = start
    setTime(start)
  }

  const seek = (fraction: number): void => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = start + fraction * duration
    setTime(video.currentTime)
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
            objectPosition: isCrop ? `${previewFocusX * 100}% 50%` : '50% 50%'
          }}
          onClick={togglePlay}
          onEnded={() => setPlaying(false)}
          preload="auto"
        />
        <BrollOverlay clip={clip} time={time} />
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
