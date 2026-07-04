import { useEffect, useMemo, useRef, useState } from 'react'
import type { Transcript } from '@shared/types'
import { useStore } from '../store'

interface WordRef {
  segmentId: number
  wordIndex: number
  text: string
}

/**
 * Click-to-edit transcript for the clip range. Fixing a word updates the
 * saved transcript, so the caption preview and every export pick it up.
 * Clearing a word hides it from captions (timing is kept).
 */
export default function TranscriptEditor({
  transcript,
  clipStart,
  clipEnd
}: {
  transcript: Transcript
  clipStart: number
  clipEnd: number
}): React.JSX.Element {
  const updateTranscriptWord = useStore((s) => s.updateTranscriptWord)
  const [editing, setEditing] = useState<{ segmentId: number; wordIndex: number } | null>(null)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const words = useMemo(() => {
    const out: WordRef[] = []
    for (const seg of transcript.segments) {
      if (seg.end < clipStart || seg.start > clipEnd) continue
      seg.words.forEach((w, wordIndex) => {
        const mid = (w.start + w.end) / 2
        if (mid >= clipStart && mid <= clipEnd) {
          out.push({ segmentId: seg.id, wordIndex, text: w.text })
        }
      })
    }
    return out
  }, [transcript, clipStart, clipEnd])

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const commit = (): void => {
    if (!editing) return
    void updateTranscriptWord(editing.segmentId, editing.wordIndex, draft)
    setEditing(null)
  }

  if (words.length === 0) {
    return <p className="text-xs leading-relaxed text-zinc-500">No speech in this range.</p>
  }

  return (
    <div>
      <p className="max-h-36 select-text overflow-y-auto text-xs leading-[1.9] text-zinc-400">
        {words.map((w) => {
          const isEditing =
            editing?.segmentId === w.segmentId && editing.wordIndex === w.wordIndex
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
                className="mx-0.5 rounded border border-accent-500 bg-surface-850 px-1 py-0 text-xs text-zinc-100 focus:outline-none"
              />
            )
          }
          return (
            <button
              key={`${w.segmentId}-${w.wordIndex}`}
              onClick={() => {
                setEditing({ segmentId: w.segmentId, wordIndex: w.wordIndex })
                setDraft(w.text)
              }}
              title={w.text ? 'Click to edit this word' : 'Hidden from captions — click to restore'}
              className={`rounded px-0.5 transition hover:bg-surface-700 hover:text-zinc-100 ${
                w.text ? '' : 'border border-dashed border-surface-600 text-zinc-600'
              }`}
            >
              {w.text || '·'}
            </button>
          )
        })}
      </p>
      <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">
        Click a word to fix the transcription — captions update in the preview and every export.
        Clear a word to hide it from captions.
      </p>
    </div>
  )
}
