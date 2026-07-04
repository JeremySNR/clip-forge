import { AudioLines, FileAudio, Brain, Image, Check, Loader2, ScanFace } from 'lucide-react'
import { useStore } from '../store'
import type { PipelineStage } from '@shared/types'

const STAGES: Array<{ id: PipelineStage; label: string; icon: React.ElementType }> = [
  { id: 'audio', label: 'Extract audio', icon: FileAudio },
  { id: 'transcribe', label: 'Transcribe speech', icon: AudioLines },
  { id: 'analyze', label: 'Find viral moments', icon: Brain },
  { id: 'reframe', label: 'Track faces for reframing', icon: ScanFace },
  { id: 'thumbnails', label: 'Create thumbnails', icon: Image }
]

const STAGE_ORDER: PipelineStage[] = ['probe', 'audio', 'transcribe', 'analyze', 'reframe', 'thumbnails', 'done']

export default function ProcessingScreen(): React.JSX.Element {
  const progress = useStore((s) => s.pipelineProgress)
  const project = useStore((s) => s.project)

  const currentIdx = progress ? STAGE_ORDER.indexOf(progress.stage) : 0
  const pct = Math.round((progress?.progress ?? 0) * 100)

  return (
    <div className="flex h-full flex-col items-center justify-center px-8">
      <div className="w-full max-w-md">
        <div className="text-center">
          <div className="text-lg font-semibold tracking-tight">{project?.name}</div>
          <div className="mt-1 text-sm text-zinc-500">{progress?.message ?? 'Working…'}</div>
        </div>

        <div className="mt-8 h-2 overflow-hidden rounded-full bg-surface-700">
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent-500 to-fuchsia-500 transition-all duration-500"
            style={{ width: `${Math.max(2, pct)}%` }}
          />
        </div>
        <div className="mt-2 text-right text-xs tabular-nums text-zinc-500">{pct}%</div>

        <div className="mt-8 space-y-2.5">
          {STAGES.map((stage) => {
            const stageIdx = STAGE_ORDER.indexOf(stage.id)
            const isDone = currentIdx > stageIdx
            const isActive = currentIdx === stageIdx
            const Icon = stage.icon
            return (
              <div
                key={stage.id}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition ${
                  isActive
                    ? 'border-accent-500/40 bg-accent-500/5'
                    : isDone
                      ? 'border-surface-700 bg-surface-900'
                      : 'border-surface-800 bg-transparent opacity-50'
                }`}
              >
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                    isDone ? 'bg-emerald-500/15 text-emerald-400' : isActive ? 'bg-accent-500/15 text-accent-400' : 'bg-surface-800 text-zinc-600'
                  }`}
                >
                  {isDone ? (
                    <Check size={16} />
                  ) : isActive ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Icon size={16} />
                  )}
                </div>
                <span className={`text-sm ${isActive ? 'font-medium text-zinc-100' : 'text-zinc-400'}`}>
                  {stage.label}
                </span>
              </div>
            )
          })}
        </div>

        <p className="mt-8 text-center text-xs leading-relaxed text-zinc-600">
          Transcription and analysis run on the OpenAI API. Long videos are transcribed in
          chunks — an hour of footage typically takes a couple of minutes.
        </p>
      </div>
    </div>
  )
}
