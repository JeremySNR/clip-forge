import { useState } from 'react'
import { Download, Pencil, Check, Loader2, AlertTriangle, FolderOpen, RefreshCw, Sparkles } from 'lucide-react'
import { useStore } from '../store'
import { formatDuration } from '../lib/format'
import ScoreBadge from './ScoreBadge'
import type { Clip } from '@shared/types'

export default function ClipsScreen(): React.JSX.Element {
  const project = useStore((s) => s.project)
  const exportAll = useStore((s) => s.exportAll)
  const exports = useStore((s) => s.exports)
  const goHome = useStore((s) => s.goHome)
  const [exportingAll, setExportingAll] = useState(false)

  if (!project) return <div />

  const doneCount = project.clips.filter((c) => exports[c.id]?.status === 'done').length

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-8 py-8">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight">
              <Sparkles size={20} className="text-accent-400" />
              {project.clips.length} clips found
            </h1>
            <p className="mt-1 text-sm text-zinc-400">
              Ranked by virality score. Open a clip to trim, reframe and style captions before
              exporting.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={goHome}
              title="Change the AI instructions and generate a new set of clips — the saved transcript is reused, so it only takes seconds"
              className="flex items-center gap-2 rounded-xl border border-surface-600 px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:bg-surface-800"
            >
              <RefreshCw size={15} />
              Regenerate
            </button>
            <button
              onClick={async () => {
                setExportingAll(true)
                try {
                  await exportAll()
                } finally {
                  setExportingAll(false)
                }
              }}
              disabled={exportingAll}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-accent-600 to-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-accent-600/25 transition hover:brightness-110 disabled:opacity-60"
            >
              {exportingAll ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              {exportingAll ? `Exporting… (${doneCount}/${project.clips.length})` : 'Export all'}
            </button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-5 xl:grid-cols-3">
          {project.clips.map((clip, i) => (
            <ClipCard key={clip.id} clip={clip} rank={i + 1} />
          ))}
        </div>
      </div>
    </div>
  )
}

function ClipCard({ clip, rank }: { clip: Clip; rank: number }): React.JSX.Element {
  const openEditor = useStore((s) => s.openEditor)
  const exportClip = useStore((s) => s.exportClip)
  const exports = useStore((s) => s.exports)
  const entry = exports[clip.id]
  const duration = clip.edit.end - clip.edit.start

  return (
    <div className="group overflow-hidden rounded-2xl border border-surface-700 bg-surface-900 transition hover:border-surface-600">
      <div
        data-testid="clip-thumb"
        className="relative aspect-video cursor-pointer bg-black"
        onClick={() => openEditor(clip.id)}
      >
        {clip.thumbnailPath ? (
          <img
            src={window.clipforge.mediaUrl(clip.thumbnailPath)}
            alt=""
            className="h-full w-full object-cover transition group-hover:opacity-90"
          />
        ) : (
          <div className="h-full w-full bg-surface-800" />
        )}
        <div className="absolute left-2.5 top-2.5 flex items-center gap-2">
          <span className="rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-zinc-300 backdrop-blur">
            #{rank}
          </span>
          <ScoreBadge score={clip.viralityScore} />
        </div>
        <span className="absolute bottom-2.5 right-2.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-zinc-200 backdrop-blur">
          {formatDuration(duration)}
        </span>
      </div>

      <div className="p-4">
        <div className="line-clamp-1 text-sm font-semibold">{clip.title}</div>
        <p className="mt-1.5 line-clamp-2 min-h-[2.2rem] text-xs leading-relaxed text-zinc-500">
          {clip.summary}
        </p>
        <div className="mt-2 line-clamp-1 text-[11px] text-accent-400/80">
          {clip.hashtags.map((h) => `#${h}`).join(' ')}
        </div>

        <div className="mt-3.5 flex items-center gap-2">
          <button
            onClick={() => openEditor(clip.id)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-surface-600 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:bg-surface-800"
          >
            <Pencil size={13} /> Edit
          </button>
          <ExportButton
            status={entry?.status}
            progress={entry?.progress ?? 0}
            outputPath={entry?.outputPath}
            error={entry?.error}
            onExport={() => void exportClip(clip.id)}
          />
        </div>
      </div>
    </div>
  )
}

export function ExportButton({
  status,
  progress,
  outputPath,
  error,
  onExport
}: {
  status?: 'exporting' | 'done' | 'error'
  progress: number
  outputPath?: string
  error?: string
  onExport: () => void
}): React.JSX.Element {
  if (status === 'exporting') {
    return (
      <div className="relative flex flex-1 items-center justify-center gap-1.5 overflow-hidden rounded-lg bg-surface-800 px-3 py-2 text-xs font-medium text-zinc-300">
        <div
          className="absolute inset-y-0 left-0 bg-accent-600/30 transition-all"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
        <Loader2 size={13} className="relative animate-spin" />
        <span className="relative tabular-nums">{Math.round(progress * 100)}%</span>
      </div>
    )
  }
  if (status === 'done' && outputPath) {
    return (
      <button
        onClick={() => void window.clipforge.showItemInFolder(outputPath)}
        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 py-2 text-xs font-medium text-emerald-400 transition hover:bg-emerald-500/25"
        title={outputPath}
      >
        <Check size={13} /> Saved
        <FolderOpen size={13} />
      </button>
    )
  }
  if (status === 'error') {
    return (
      <button
        onClick={onExport}
        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-500/15 px-3 py-2 text-xs font-medium text-red-400 transition hover:bg-red-500/25"
        title={error}
      >
        <AlertTriangle size={13} /> Retry
      </button>
    )
  }
  return (
    <button
      onClick={onExport}
      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-accent-500"
    >
      <Download size={13} /> Export
    </button>
  )
}
