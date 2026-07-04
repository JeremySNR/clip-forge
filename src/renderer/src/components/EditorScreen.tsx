import {
  Captions,
  CaseUpper,
  Crop,
  GalleryVerticalEnd,
  ImagePlus,
  Quote,
  ScanFace,
  Scissors,
  Trash2
} from 'lucide-react'
import { useStore } from '../store'
import PreviewPlayer from './PreviewPlayer'
import TrimBar from './TrimBar'
import ScoreBadge from './ScoreBadge'
import TranscriptEditor from './TranscriptEditor'
import { ExportButton } from './ClipsScreen'
import { CAPTION_STYLES } from '@shared/captionStyles'
import { formatTimecode } from '../lib/format'
import type { AspectRatio, BrollItem, BrollMode, Clip, FramingMode, ReframeMode } from '@shared/types'

const ASPECTS: Array<{ value: AspectRatio; label: string }> = [
  { value: '9:16', label: '9:16' },
  { value: '1:1', label: '1:1' },
  { value: '16:9', label: '16:9' },
  { value: 'original', label: 'Original' }
]

export default function EditorScreen(): React.JSX.Element {
  const project = useStore((s) => s.project)
  const selectedClipId = useStore((s) => s.selectedClipId)
  const updateClip = useStore((s) => s.updateClip)
  const updateClipLocal = useStore((s) => s.updateClipLocal)
  const exportClip = useStore((s) => s.exportClip)
  const cancelExport = useStore((s) => s.cancelExport)
  const exports = useStore((s) => s.exports)

  const clip = project?.clips.find((c) => c.id === selectedClipId) ?? null

  if (!project || !clip) return <div />

  const set = (edit: Partial<Clip['edit']>): void => {
    void updateClip({ ...clip, edit: { ...clip.edit, ...edit } })
  }
  const setLocal = (edit: Partial<Clip['edit']>): void => {
    updateClipLocal({ ...clip, edit: { ...clip.edit, ...edit } })
  }
  const updateBroll = (id: string, patch: Partial<BrollItem>): void => {
    void updateClip({
      ...clip,
      broll: clip.broll.map((b) => (b.id === id ? { ...b, ...patch } : b))
    })
  }
  const removeBroll = (id: string): void => {
    void updateClip({ ...clip, broll: clip.broll.filter((b) => b.id !== id) })
  }

  const entry = exports[clip.id]
  const windowStart = Math.max(0, clip.suggestedStart - 15)
  const windowEnd = Math.min(project.video.durationSec, clip.suggestedEnd + 15)
  const cropDisabled = clip.edit.aspect === 'original'

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-h-0 flex-1 flex-col p-6">
        <PreviewPlayer project={project} clip={clip} />
      </div>

      <aside className="flex w-[400px] shrink-0 flex-col gap-5 overflow-y-auto border-l border-surface-700 bg-surface-900 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <input
              value={clip.title}
              onChange={(e) => updateClipLocal({ ...clip, title: e.target.value })}
              onBlur={() => void updateClip(clip)}
              className="w-full rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-[15px] font-semibold focus:border-surface-600 focus:bg-surface-850 focus:outline-none"
            />
            <p className="mt-1 px-1 text-xs leading-relaxed text-zinc-500">{clip.summary}</p>
          </div>
          <ScoreBadge score={clip.viralityScore} size="lg" />
        </div>

        <div className="rounded-xl border border-surface-700 bg-surface-850 px-3.5 py-3 text-xs leading-relaxed text-zinc-400">
          <span className="font-semibold text-zinc-300">Why this score: </span>
          {clip.viralityReason}
          {clip.visualSummary && (
            <>
              {' '}
              <span className="font-semibold text-zinc-300">Visuals: </span>
              {clip.visualSummary}
            </>
          )}
        </div>

        <Section icon={Scissors} title="Trim">
          <TrimBar
            windowStart={windowStart}
            windowEnd={windowEnd}
            start={clip.edit.start}
            end={clip.edit.end}
            onChange={(start, end) => setLocal({ start, end })}
            onCommit={() => void updateClip(clip)}
          />
          <div className="mt-3">
            <Toggle
              label="Tighten cuts — remove pauses and filler words"
              checked={clip.edit.tightenCuts}
              onChange={(v) => set({ tightenCuts: v })}
            />
          </div>
        </Section>

        <Section icon={Crop} title="Layout">
          <div className="grid grid-cols-4 gap-1.5">
            {ASPECTS.map((a) => (
              <button
                key={a.value}
                onClick={() => set({ aspect: a.value })}
                className={`rounded-lg border px-2 py-2 text-xs font-medium transition ${
                  clip.edit.aspect === a.value
                    ? 'border-accent-500 bg-accent-500/10 text-zinc-100'
                    : 'border-surface-600 text-zinc-400 hover:bg-surface-800'
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
          {!cropDisabled && (
            <>
              <div className="mt-3 grid grid-cols-2 gap-1.5">
                {(
                  [
                    { value: 'crop', label: 'Fill (crop)' },
                    { value: 'fit-blur', label: 'Fit + blur' }
                  ] as Array<{ value: ReframeMode; label: string }>
                ).map((m) => (
                  <button
                    key={m.value}
                    onClick={() => set({ reframeMode: m.value })}
                    className={`rounded-lg border px-2 py-2 text-xs font-medium transition ${
                      clip.edit.reframeMode === m.value
                        ? 'border-accent-500 bg-accent-500/10 text-zinc-100'
                        : 'border-surface-600 text-zinc-400 hover:bg-surface-800'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {clip.edit.reframeMode === 'crop' && (
                <>
                  {clip.focusTrack && (
                    <div className="mt-3 grid grid-cols-2 gap-1.5">
                      {(
                        [
                          { value: 'auto', label: 'Auto (AI faces)' },
                          { value: 'manual', label: 'Manual' }
                        ] as Array<{ value: FramingMode; label: string }>
                      ).map((f) => (
                        <button
                          key={f.value}
                          onClick={() => set({ framing: f.value })}
                          className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-medium transition ${
                            clip.edit.framing === f.value
                              ? 'border-accent-500 bg-accent-500/10 text-zinc-100'
                              : 'border-surface-600 text-zinc-400 hover:bg-surface-800'
                          }`}
                        >
                          {f.value === 'auto' && <ScanFace size={13} />}
                          {f.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {clip.edit.framing === 'auto' && clip.focusTrack ? (
                    <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                      Following {clip.focusTrack.length} tracked speaker position
                      {clip.focusTrack.length === 1 ? '' : 's'} — the crop cuts automatically when
                      the speaker moves.
                    </p>
                  ) : (
                    <div className="mt-3">
                      <div className="mb-1.5 flex justify-between text-[11px] text-zinc-500">
                        <span>Focus left</span>
                        <span>Focus right</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(clip.edit.focusX * 100)}
                        onChange={(e) => setLocal({ focusX: Number(e.target.value) / 100 })}
                        onMouseUp={() => void updateClip(clip)}
                        onTouchEnd={() => void updateClip(clip)}
                        className="w-full"
                      />
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </Section>

        <Section icon={Captions} title="Captions">
          <Toggle
            label="Burn in captions"
            checked={clip.edit.captionsEnabled}
            onChange={(v) => set({ captionsEnabled: v })}
          />
          {clip.edit.captionsEnabled && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {CAPTION_STYLES.map((style) => (
                <button
                  key={style.id}
                  onClick={() => set({ captionStyleId: style.id })}
                  className={`rounded-xl border px-3 py-2.5 text-left transition ${
                    clip.edit.captionStyleId === style.id
                      ? 'border-accent-500 bg-accent-500/10'
                      : 'border-surface-600 hover:bg-surface-800'
                  }`}
                >
                  <div
                    className="text-sm"
                    style={{
                      fontFamily: `'${style.fontFamily}', sans-serif`,
                      fontWeight: style.bold ? 700 : 400,
                      color: style.textColor
                    }}
                  >
                    {style.uppercase ? 'SO I ' : 'so I '}
                    <span
                      style={{
                        color: style.highlightColor,
                        backgroundColor: style.highlightBoxColor ?? 'transparent',
                        borderRadius: 4,
                        padding: style.highlightBoxColor ? '0 3px' : 0
                      }}
                    >
                      {style.uppercase ? 'SAID' : 'said'}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-500">{style.name}</div>
                </button>
              ))}
            </div>
          )}
          <div className="mt-3">
            <Toggle
              label="Show hook title at start"
              checked={clip.edit.showTitle}
              onChange={(v) => set({ showTitle: v })}
            />
          </div>
          {clip.edit.showTitle && (
            <div className="mt-2.5">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] text-zinc-500">
                <CaseUpper size={13} /> Hook text
              </div>
              <input
                value={clip.hook}
                onChange={(e) => updateClipLocal({ ...clip, hook: e.target.value })}
                onBlur={() => void updateClip(clip)}
                className="w-full rounded-lg border border-surface-600 bg-surface-850 px-3 py-2 text-xs text-zinc-200 focus:border-accent-500 focus:outline-none"
              />
            </div>
          )}
        </Section>

        <Section icon={ImagePlus} title="B-roll">
          {clip.broll.length === 0 ? (
            <p className="text-xs leading-relaxed text-zinc-500">
              No image inserts for this clip. Enable “AI B-roll images” when generating clips to
              get keyword-triggered visuals.
            </p>
          ) : (
            <div className="space-y-2">
              {clip.broll.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-center gap-3 rounded-xl border border-surface-600 p-2.5 transition ${
                    item.enabled ? '' : 'opacity-50'
                  }`}
                >
                  {item.imagePath && (
                    <img
                      src={window.clipforge.mediaUrl(item.imagePath)}
                      alt={item.trigger}
                      className="h-12 w-16 shrink-0 rounded-lg bg-black object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold">“{item.trigger}”</div>
                    <div className="mt-0.5 text-[11px] tabular-nums text-zinc-500">
                      {formatTimecode(item.start - clip.edit.start)} ·{' '}
                      {(item.end - item.start).toFixed(1)}s
                    </div>
                    <div className="mt-1.5 flex gap-1">
                      {(
                        [
                          { value: 'fullscreen', label: 'Full' },
                          { value: 'overlay', label: 'Overlay' }
                        ] as Array<{ value: BrollMode; label: string }>
                      ).map((m) => (
                        <button
                          key={m.value}
                          onClick={() => updateBroll(item.id, { mode: m.value })}
                          className={`rounded-md border px-2 py-0.5 text-[10px] font-medium transition ${
                            item.mode === m.value
                              ? 'border-accent-500 bg-accent-500/10 text-zinc-200'
                              : 'border-surface-600 text-zinc-500 hover:bg-surface-800'
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <button
                      onClick={() => updateBroll(item.id, { enabled: !item.enabled })}
                      title={item.enabled ? 'Disable this insert' : 'Enable this insert'}
                      className={`relative h-5 w-9 rounded-full transition ${
                        item.enabled ? 'bg-accent-500' : 'bg-surface-600'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                          item.enabled ? 'left-[18px]' : 'left-0.5'
                        }`}
                      />
                    </button>
                    <button
                      onClick={() => removeBroll(item.id)}
                      title="Remove this insert"
                      className="rounded-md p-1 text-zinc-600 transition hover:bg-surface-700 hover:text-red-400"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section icon={Quote} title="Transcript">
          {project.transcript ? (
            <TranscriptEditor
              transcript={project.transcript}
              clipStart={clip.edit.start}
              clipEnd={clip.edit.end}
            />
          ) : (
            <p className="text-xs leading-relaxed text-zinc-500">No transcript available.</p>
          )}
        </Section>

        <Section icon={GalleryVerticalEnd} title="Hashtags">
          <div className="flex flex-wrap gap-1.5">
            {clip.hashtags.map((h) => (
              <span
                key={h}
                className="select-text rounded-full bg-surface-800 px-2.5 py-1 text-[11px] text-accent-400"
              >
                #{h}
              </span>
            ))}
          </div>
        </Section>

        <div className="sticky bottom-0 -mx-5 -mb-5 border-t border-surface-700 bg-surface-900 p-4">
          <div className="flex">
            <ExportButton
              status={entry?.status}
              progress={entry?.progress ?? 0}
              outputPath={entry?.outputPath}
              error={entry?.error}
              onExport={() => void exportClip(clip.id)}
              onCancel={() => void cancelExport(clip.id)}
            />
          </div>
          {entry?.status === 'error' && entry.error && (
            <p className="mt-2 text-[11px] leading-relaxed text-red-400">{entry.error}</p>
          )}
        </div>
      </aside>
    </div>
  )
}

function Section({
  icon: Icon,
  title,
  children
}: {
  icon: React.ElementType
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section>
      <h3 className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        <Icon size={13} />
        {title}
      </h3>
      {children}
    </section>
  )
}

function Toggle({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}): React.JSX.Element {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between rounded-lg border border-surface-600 px-3 py-2.5 text-left text-xs font-medium text-zinc-300 transition hover:bg-surface-800"
    >
      {label}
      <span
        className={`relative h-5 w-9 rounded-full transition ${checked ? 'bg-accent-500' : 'bg-surface-600'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`}
        />
      </span>
    </button>
  )
}
