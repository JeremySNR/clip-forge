import { useEffect, useMemo, useRef, useState } from 'react'
import { Scissors, X } from 'lucide-react'
import type { Transcript } from '@shared/types'
import { useStore } from '../store'
import { usePreviewBus } from '../lib/previewBus'
import { formatTimecode } from '../lib/format'

interface WordRef {
  segmentId: number
  wordIndex: number
  text: string
  start: number
  end: number
}

/** Pre/post roll applied when trimming the clip to a word selection. */
const TRIM_PRE_ROLL_SEC = 0.15
const TRIM_POST_ROLL_SEC = 0.3

/**
 * Transcript-driven editing for the clip range:
 * - click a word to seek the preview to it;
 * - drag across words to select a range, then trim the clip to it;
 * - double-click a word to fix the transcription (clear it to hide it from
 *   captions — timing is kept);
 * - the word being spoken is highlighted while the preview plays.
 */
export default function TranscriptEditor({
  transcript,
  clipStart,
  clipEnd,
  onTrim
}: {
  transcript: Transcript
  clipStart: number
  clipEnd: number
  onTrim: (start: number, end: number) => void
}): React.JSX.Element {
  const updateTranscriptWord = useStore((s) => s.updateTranscriptWord)
  const time = usePreviewBus((s) => s.time)
  const seek = usePreviewBus((s) => s.seek)
  const [editing, setEditing] = useState<{ segmentId: number; wordIndex: number } | null>(null)
  const [draft, setDraft] = useState('')
  const [selection, setSelection] = useState<{ a: number; b: number } | null>(null)
  const dragAnchor = useRef<number | null>(null)
  const dragged = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const words = useMemo(() => {
    const out: WordRef[] = []
    for (const seg of transcript.segments) {
      if (seg.end < clipStart || seg.start > clipEnd) continue
      seg.words.forEach((w, wordIndex) => {
        const mid = (w.start + w.end) / 2
        if (mid >= clipStart && mid <= clipEnd) {
          out.push({ segmentId: seg.id, wordIndex, text: w.text, start: w.start, end: w.end })
        }
      })
    }
    return out
  }, [transcript, clipStart, clipEnd])

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  // Word selection drags end wherever the pointer is released.
  useEffect(() => {
    const up = (): void => {
      dragAnchor.current = null
    }
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  }, [])

  const commit = (): void => {
    if (!editing) return
    void updateTranscriptWord(editing.segmentId, editing.wordIndex, draft)
    setEditing(null)
  }

  if (words.length === 0) {
    return <p className="text-xs leading-relaxed text-zinc-500">No speech in this range.</p>
  }

  const range = selection ? [Math.min(selection.a, selection.b), Math.max(selection.a, selection.b)] : null
  const selDuration = range
    ? words[range[1]].end + TRIM_POST_ROLL_SEC - (words[range[0]].start - TRIM_PRE_ROLL_SEC)
    : 0

  return (
    <div>
      <p className="max-h-40 overflow-y-auto text-xs leading-[1.9] text-zinc-400">
        {words.map((w, i) => {
          const isEditing = editing?.segmentId === w.segmentId && editing.wordIndex === w.wordIndex
          if (isEditing) {
            return (
              <input
                key={`${w.segmentId}-${w.wordIndex}`}
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commit()
                  if (e.key === 'Escape') setEditing(null)
                }}
                size={Math.max(3, draft.length + 1)}
                className="mx-0.5 rounded border border-white/40 bg-surface-850 px-1 py-0 text-xs text-zinc-100 focus:outline-none"
              />
            )
          }
          const selected = range !== null && i >= range[0] && i <= range[1]
          const isSpoken = time >= w.start && time < w.end
          return (
            <button
              key={`${w.segmentId}-${w.wordIndex}`}
              onPointerDown={(e) => {
                e.preventDefault()
                dragAnchor.current = i
                dragged.current = false
                setSelection(null)
              }}
              onPointerEnter={() => {
                if (dragAnchor.current !== null && dragAnchor.current !== i) {
                  dragged.current = true
                  setSelection({ a: dragAnchor.current, b: i })
                }
              }}
              onClick={() => {
                if (!dragged.current) seek(w.start)
              }}
              onDoubleClick={() => {
                setSelection(null)
                setEditing({ segmentId: w.segmentId, wordIndex: w.wordIndex })
                setDraft(w.text)
              }}
              title={
                w.text
                  ? 'Click to seek · drag to select · double-click to edit'
                  : 'Hidden from captions — double-click to restore'
              }
              className={`rounded px-0.5 transition hover:text-zinc-100 ${
                selected
                  ? 'bg-white/25 text-zinc-100'
                  : isSpoken
                    ? 'bg-white/15 text-white'
                    : 'hover:bg-surface-700'
              } ${w.text ? '' : 'border border-dashed border-surface-600 text-zinc-600'}`}
            >
              {w.text || '·'}
            </button>
          )
        })}
      </p>
      {range && range[1] > range[0] ? (
        <div className="mt-2.5 flex items-center gap-2">
          <button
            onClick={() => {
              onTrim(
                Math.max(0, words[range[0]].start - TRIM_PRE_ROLL_SEC),
                words[range[1]].end + TRIM_POST_ROLL_SEC
              )
              setSelection(null)
            }}
            className="flex items-center gap-1.5 rounded-lg bg-zinc-100 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-900 transition hover:bg-white"
          >
            <Scissors size={12} />
            Trim clip to selection ({formatTimecode(selDuration)})
          </button>
          <button
            onClick={() => setSelection(null)}
            title="Clear selection"
            className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-surface-700 hover:text-zinc-200"
          >
            <X size={13} />
          </button>
        </div>
      ) : (
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">
          Click a word to jump there · drag across words to trim the clip to them · double-click
          to fix the transcription (clear a word to hide it from captions).
        </p>
      )}
    </div>
  )
}
