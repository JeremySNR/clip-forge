import { FileVideo, FileWarning } from 'lucide-react'
import { useStore } from '../store'

/**
 * Shown when the project's source video no longer exists on disk (moved or
 * deleted). Previews and exports need the file, so offer a relink flow that
 * keeps the transcript and clips intact.
 */
export default function MissingSourceBanner(): React.JSX.Element | null {
  const project = useStore((s) => s.project)
  const relinkVideo = useStore((s) => s.relinkVideo)

  if (!project?.sourceMissing) return null

  return (
    <div
      data-testid="missing-source-banner"
      className="mt-5 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300"
    >
      <FileWarning size={18} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <span className="font-semibold">Source video not found. </span>
        <span className="text-amber-300/80">
          {project.video.path} — previews and exports need it. Your transcript and clips are safe.
        </span>
      </div>
      <button
        onClick={() => void relinkVideo()}
        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/30"
      >
        <FileVideo size={13} />
        Locate video…
      </button>
    </div>
  )
}
