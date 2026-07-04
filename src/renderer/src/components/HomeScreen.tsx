import { useState } from 'react'
import {
  Upload,
  Film,
  Sparkles,
  Trash2,
  AlertTriangle,
  Wand2,
  Clock
} from 'lucide-react'
import { useStore } from '../store'
import { formatDuration, formatBytes } from '../lib/format'
import type { ClipLengthPreference } from '@shared/types'

const LENGTH_OPTIONS: Array<{ value: ClipLengthPreference; label: string; hint: string }> = [
  { value: 'auto', label: 'Auto', hint: 'AI decides' },
  { value: 'short', label: 'Short', hint: '15–30s' },
  { value: 'medium', label: 'Medium', hint: '30–60s' },
  { value: 'long', label: 'Long', hint: '60–90s' }
]

export default function HomeScreen(): React.JSX.Element {
  const project = useStore((s) => s.project)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-8 py-10">
        {project ? <SetupPanel /> : <ImportHero />}
        <RecentProjects />
      </div>
    </div>
  )
}

function ImportHero(): React.JSX.Element {
  const importVideo = useStore((s) => s.importVideo)
  const pipelineError = useStore((s) => s.pipelineError)
  const [busy, setBusy] = useState(false)

  return (
    <div className="flex flex-col items-center pb-4 pt-8 text-center">
      <h1 className="max-w-2xl text-4xl font-bold leading-tight tracking-tight">
        Turn long videos into{' '}
        <span className="bg-gradient-to-r from-accent-400 to-fuchsia-400 bg-clip-text text-transparent">
          viral clips
        </span>
      </h1>
      <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-zinc-400">
        Drop in a podcast, webinar or stream. ClipForge transcribes it, finds the best moments
        with AI, scores them for virality and renders caption-burned vertical clips.
      </p>

      {pipelineError && (
        <div className="mt-6 flex w-full max-w-xl items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-left text-sm text-red-300">
          <AlertTriangle size={17} className="mt-0.5 shrink-0" />
          <span>{pipelineError}</span>
        </div>
      )}

      <button
        onClick={async () => {
          setBusy(true)
          try {
            await importVideo()
          } finally {
            setBusy(false)
          }
        }}
        disabled={busy}
        className="mt-8 flex w-full max-w-xl cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-surface-600 bg-surface-900/60 px-8 py-12 transition hover:border-accent-500/60 hover:bg-surface-850 disabled:opacity-60"
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-500/15">
          <Upload size={24} className="text-accent-400" />
        </div>
        <div className="text-[15px] font-semibold">
          {busy ? 'Reading video…' : 'Choose a video to clip'}
        </div>
        <div className="text-xs text-zinc-500">MP4, MOV, MKV, WEBM and more</div>
      </button>
    </div>
  )
}

function SetupPanel(): React.JSX.Element {
  const project = useStore((s) => s.project)!
  const analyze = useStore((s) => s.analyze)
  const goHomeClear = useStore((s) => s.deleteProject)
  const settings = useStore((s) => s.settings)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const pipelineError = useStore((s) => s.pipelineError)
  const [prompt, setPrompt] = useState(project.prompt)
  const [clipLength, setClipLength] = useState<ClipLengthPreference>('auto')

  const needsKey = settings !== null && !settings.hasApiKey

  return (
    <div className="pb-6">
      <h1 className="text-2xl font-bold tracking-tight">Set up your clips</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Tell the AI what to look for, then generate clips.
      </p>

      <div className="mt-6 grid grid-cols-5 gap-6">
        <div className="col-span-2 rounded-2xl border border-surface-700 bg-surface-900 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-800">
              <Film size={18} className="text-accent-400" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{project.video.fileName}</div>
              <div className="mt-0.5 text-xs text-zinc-500">
                {formatDuration(project.video.durationSec)} · {project.video.width}×
                {project.video.height} · {formatBytes(project.video.sizeBytes)}
              </div>
            </div>
          </div>
          <video
            src={window.clipforge.mediaUrl(project.video.path)}
            className="mt-4 aspect-video w-full rounded-xl bg-black object-contain"
            controls
            preload="metadata"
          />
          <button
            onClick={() => void goHomeClear(project.id)}
            className="mt-3 flex items-center gap-1.5 text-xs text-zinc-500 transition hover:text-red-400"
          >
            <Trash2 size={13} /> Remove and choose another video
          </button>
        </div>

        <div className="col-span-3 flex flex-col gap-5">
          <div className="rounded-2xl border border-surface-700 bg-surface-900 p-5">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <Wand2 size={15} className="text-accent-400" />
              AI instructions <span className="font-normal text-zinc-500">(optional)</span>
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={'e.g. "Focus on the moments about pricing strategy" or "Find the funniest exchanges between the hosts"'}
              rows={3}
              className="mt-3 w-full resize-none rounded-xl border border-surface-600 bg-surface-850 px-3.5 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-accent-500 focus:outline-none"
            />
          </div>

          <div className="rounded-2xl border border-surface-700 bg-surface-900 p-5">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <Clock size={15} className="text-accent-400" />
              Preferred clip length
            </label>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {LENGTH_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setClipLength(opt.value)}
                  className={`rounded-xl border px-3 py-2.5 text-center transition ${
                    clipLength === opt.value
                      ? 'border-accent-500 bg-accent-500/10 text-zinc-100'
                      : 'border-surface-600 bg-surface-850 text-zinc-400 hover:border-surface-600 hover:bg-surface-800'
                  }`}
                >
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className="mt-0.5 text-[11px] text-zinc-500">{opt.hint}</div>
                </button>
              ))}
            </div>
          </div>

          {pipelineError && (
            <div className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              <AlertTriangle size={17} className="mt-0.5 shrink-0" />
              <span>{pipelineError}</span>
            </div>
          )}

          {needsKey ? (
            <button
              onClick={() => setSettingsOpen(true)}
              className="flex items-center justify-center gap-2 rounded-xl bg-amber-500/15 px-5 py-3.5 text-sm font-semibold text-amber-400 transition hover:bg-amber-500/25"
            >
              Add your OpenAI API key first
            </button>
          ) : (
            <button
              onClick={() => void analyze({ prompt, clipLength })}
              className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-accent-600 to-fuchsia-600 px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-accent-600/25 transition hover:brightness-110"
            >
              <Sparkles size={17} />
              Get clips
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function RecentProjects(): React.JSX.Element | null {
  const projects = useStore((s) => s.projects)
  const project = useStore((s) => s.project)
  const openProject = useStore((s) => s.openProject)
  const deleteProject = useStore((s) => s.deleteProject)

  const others = projects.filter((p) => p.id !== project?.id)
  if (others.length === 0) return null

  return (
    <div className="mt-10">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
        Recent projects
      </h2>
      <div className="mt-4 grid grid-cols-3 gap-4">
        {others.map((p) => (
          <div
            key={p.id}
            className="group cursor-pointer overflow-hidden rounded-2xl border border-surface-700 bg-surface-900 transition hover:border-surface-600 hover:bg-surface-850"
            onClick={() => void openProject(p.id)}
          >
            <div className="flex aspect-video items-center justify-center bg-black">
              {p.thumbnailPath ? (
                <img
                  src={window.clipforge.mediaUrl(p.thumbnailPath)}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <Film size={28} className="text-zinc-700" />
              )}
            </div>
            <div className="flex items-center justify-between gap-2 px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{p.name}</div>
                <div className="mt-0.5 text-xs text-zinc-500">
                  {formatDuration(p.durationSec)} · {p.clipCount} clip{p.clipCount === 1 ? '' : 's'}
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  void deleteProject(p.id)
                }}
                className="rounded-lg p-1.5 text-zinc-600 opacity-0 transition hover:bg-surface-700 hover:text-red-400 group-hover:opacity-100"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
