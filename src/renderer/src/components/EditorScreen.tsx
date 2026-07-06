import { useEffect, useState } from 'react'
import {
  Captions,
  CaseUpper,
  Check,
  Copy,
  Crop,
  ExternalLink,
  GalleryVerticalEnd,
  ImagePlus,
  Loader2,
  Quote,
  ScanFace,
  Scissors,
  Send,
  Share2,
  Sparkles,
  Trash2,
  Type,
  X
} from 'lucide-react'
import type { TimelineData } from '@shared/types'
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
  const customFonts = useStore((s) => s.customFonts)

  const clip = project?.clips.find((c) => c.id === selectedClipId) ?? null

  const videoPath = project?.video.path
  const sourceMissing = project?.sourceMissing ?? false
  const windowStart = clip ? Math.max(0, clip.suggestedStart - 15) : 0
  const windowEnd =
    project && clip
      ? Math.min(project.video.durationSec, clip.suggestedEnd + 15)
      : 0

  // Filmstrip + waveform for the trim window (cached in the main process).
  // Keyed so a stale window's data never renders for the current clip.
  const timelineKey = `${videoPath}|${windowStart.toFixed(2)}|${windowEnd.toFixed(2)}`
  const [loadedTimeline, setLoadedTimeline] = useState<{ key: string; data: TimelineData } | null>(
    null
  )
  useEffect(() => {
    if (!videoPath || sourceMissing) return
    let alive = true
    window.clipforge
      .getTimeline(videoPath, windowStart, windowEnd)
      .then((data) => {
        if (alive) setLoadedTimeline({ key: timelineKey, data })
      })
      .catch(() => undefined) // timeline is progressive enhancement
    return () => {
      alive = false
    }
  }, [videoPath, sourceMissing, windowStart, windowEnd, timelineKey])
  const timeline = loadedTimeline?.key === timelineKey ? loadedTimeline.data : null

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
              className="w-full text-ellipsis rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-[15px] font-semibold focus:border-surface-600 focus:bg-surface-850 focus:outline-none"
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
            timeline={timeline}
            onChange={(start, end) => setLocal({ start, end })}
            onCommit={() => {
              // Read the live clip: the pointerup closure inside TrimBar was
              // created at drag start, so `clip` here would be pre-drag.
              const current = useStore
                .getState()
                .project?.clips.find((c) => c.id === clip.id)
              if (current) void updateClip(current)
            }}
          />
          <div className="mt-3">
            <Toggle
              label="Tighten cuts — remove pauses and filler words"
              checked={clip.edit.tightenCuts}
              onChange={(v) => set({ tightenCuts: v })}
            />
          </div>
          <div className="mt-2">
            <Toggle
              label="Auto zoom — punch-ins on emphasis, jump zooms covering cuts"
              checked={clip.edit.autoZoom ?? false}
              onChange={(v) => set({ autoZoom: v })}
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
                    ? 'border-white/30 bg-white/[0.07] text-zinc-100'
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
                        ? 'border-white/30 bg-white/[0.07] text-zinc-100'
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
                              ? 'border-white/30 bg-white/[0.07] text-zinc-100'
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
                      {clip.focusTrack.length === 1 ? '' : 's'} — the crop pans smoothly as the
                      speaker moves and cuts on camera or speaker changes.
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
                      ? 'border-white/30 bg-white/[0.07]'
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
          {clip.edit.captionsEnabled && (
            <div className="mt-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-zinc-500">
                <Type size={13} /> Caption font
              </div>
              {customFonts.length > 0 ? (
                <select
                  value={clip.edit.captionFontFamily ?? ''}
                  onChange={(e) => set({ captionFontFamily: e.target.value || null })}
                  className="w-full rounded-lg border border-surface-600 bg-surface-850 px-3 py-2 text-xs text-zinc-200 focus:border-white/25 focus:outline-none"
                >
                  <option value="">Style default</option>
                  {customFonts.map((f) => (
                    <option key={f.fileName} value={f.family}>
                      {f.family}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-[11px] leading-relaxed text-zinc-500">
                  Using the style’s built-in font. Upload your own fonts in Settings → Custom
                  fonts to pick them here.
                </p>
              )}
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
                className="w-full rounded-lg border border-surface-600 bg-surface-850 px-3 py-2 text-xs text-zinc-200 focus:border-white/25 focus:outline-none"
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
                              ? 'border-white/30 bg-white/[0.07] text-zinc-200'
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
                        item.enabled ? 'bg-zinc-100' : 'bg-surface-600'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${
                          item.enabled ? 'left-[18px] bg-zinc-900' : 'left-0.5 bg-white'
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
              onTrim={(start, end) => {
                void updateClip({
                  ...clip,
                  edit: {
                    ...clip.edit,
                    start: Math.max(windowStart, start),
                    end: Math.min(windowEnd, end)
                  }
                })
              }}
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
                className="select-text rounded-full border border-white/[0.06] bg-white/[0.04] px-2.5 py-1 text-[11px] text-zinc-300"
              >
                #{h}
              </span>
            ))}
          </div>
        </Section>

        <ShareSection clip={clip} />

        <div className="sticky bottom-0 -mx-5 -mb-5 border-t border-white/[0.06] bg-surface-900/80 p-4 backdrop-blur-xl">
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

/**
 * Post-to-social helpers. Direct in-app posting to TikTok needs an audited
 * TikTok developer app (unaudited clients are forced to private-only posts),
 * so the local-first flow is: generate the caption here, copy it, and hand
 * off to TikTok Studio's upload page with the exported file.
 */
function ShareSection({ clip }: { clip: Clip }): React.JSX.Element {
  const updateClip = useStore((s) => s.updateClip)
  const updateClipLocal = useStore((s) => s.updateClipLocal)
  const generateCaption = useStore((s) => s.generateCaption)
  const busy = useStore((s) => s.captionBusy[clip.id] ?? false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generate = async (): Promise<void> => {
    setError(null)
    try {
      await generateCaption(clip.id)
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '') : String(err))
    }
  }

  const copy = async (): Promise<void> => {
    if (!clip.caption) return
    await navigator.clipboard.writeText(clip.caption)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Section icon={Share2} title="Share">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] text-zinc-500">Post caption (AI)</span>
        <button
          onClick={() => void generate()}
          disabled={busy}
          className="flex items-center gap-1 rounded-md border border-surface-600 px-2 py-1 text-[11px] font-medium text-zinc-300 transition hover:bg-surface-800 disabled:opacity-60"
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
          {busy ? 'Writing…' : clip.caption ? 'Regenerate' : 'Generate caption'}
        </button>
      </div>
      <textarea
        value={clip.caption ?? ''}
        onChange={(e) => updateClipLocal({ ...clip, caption: e.target.value })}
        onBlur={() => void updateClip(clip)}
        placeholder="Generate a scroll-stopping caption for TikTok / Reels / Shorts, or write your own."
        rows={3}
        className="w-full resize-none rounded-lg border border-surface-600 bg-surface-850 px-3 py-2 text-xs leading-relaxed text-zinc-200 placeholder:text-zinc-600 focus:border-white/25 focus:outline-none"
      />
      {error && <p className="mt-1.5 text-[11px] leading-relaxed text-red-400">{error}</p>}
      <div className="mt-2 flex gap-1.5">
        <button
          onClick={() => void copy()}
          disabled={!clip.caption}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-surface-600 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:bg-surface-800 disabled:opacity-40"
        >
          {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
          {copied ? 'Copied' : 'Copy caption'}
        </button>
        <a
          href="https://www.tiktok.com/tiktokstudio/upload"
          target="_blank"
          rel="noreferrer"
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-surface-600 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:bg-surface-800"
        >
          <ExternalLink size={13} />
          Open TikTok upload
        </a>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
        Export the clip, then drop the file into TikTok Studio and paste the caption. TikTok
        only allows fully public in-app posting for audited web services, so this hand-off is
        the reliable local route.
      </p>
      <WorkvivoPostBlock clip={clip} />
    </Section>
  )
}

/**
 * One-click posting of the current clip to a chosen WorkVivo space. Renders the
 * clip and uploads it with the AI caption as the post text; falls back to a
 * "connect it in Settings" prompt when the integration is not configured.
 */
function WorkvivoPostBlock({ clip }: { clip: Clip }): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const spaces = useStore((s) => s.workvivoSpaces)
  const spacesError = useStore((s) => s.workvivoSpacesError)
  const loadSpaces = useStore((s) => s.loadWorkvivoSpaces)
  const post = useStore((s) => s.postClipToWorkvivo)
  const cancel = useStore((s) => s.cancelWorkvivoPost)
  const clear = useStore((s) => s.clearWorkvivoPost)
  const entry = useStore((s) => s.workvivoPosts[clip.id])
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const configured = settings?.workvivo.configured ?? false
  const defaultSpaceId = settings?.workvivo.defaultSpaceId ?? ''
  const [picked, setPicked] = useState('')
  // Effective selection: an explicit pick, else the configured default, else
  // the first space. Computed (not stored) so no effect has to seed it.
  const spaceId = picked || defaultSpaceId || spaces[0]?.id || ''

  useEffect(() => {
    if (configured) void loadSpaces()
  }, [configured, loadSpaces])

  if (!configured) {
    return (
      <div className="mt-3 border-t border-surface-700 pt-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-zinc-500">
          <Send size={12} /> Post to WorkVivo
        </div>
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-surface-600 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:bg-surface-800"
        >
          <Send size={13} />
          Connect WorkVivo in Settings
        </button>
        <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
          Once connected, post this clip straight to a WorkVivo space with its caption in one click.
        </p>
      </div>
    )
  }

  const posting = entry?.status === 'posting'

  return (
    <div className="mt-3 border-t border-surface-700 pt-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-zinc-500">
        <Send size={12} /> Post to WorkVivo
      </div>
      <select
        value={spaceId}
        onChange={(e) => setPicked(e.target.value)}
        disabled={posting || spaces.length === 0}
        className="w-full rounded-lg border border-surface-600 bg-surface-850 px-3 py-2 text-xs text-zinc-200 focus:border-white/25 focus:outline-none disabled:opacity-60"
      >
        {spaces.length === 0 ? (
          <option value="">No spaces available</option>
        ) : (
          spaces.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))
        )}
      </select>
      {spacesError && <p className="mt-1.5 text-[11px] leading-relaxed text-red-400">{spacesError}</p>}

      {posting ? (
        <div className="mt-2 rounded-lg border border-surface-600 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2 text-xs text-zinc-300">
            <span className="flex items-center gap-2">
              <Loader2 size={13} className="animate-spin" />
              {entry.message || 'Posting…'}
            </span>
            <button
              onClick={() => void cancel(clip.id)}
              className="rounded-md p-1 text-zinc-500 transition hover:bg-surface-700 hover:text-zinc-200"
              title="Cancel"
            >
              <X size={13} />
            </button>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-700">
            <div
              className="h-full rounded-full bg-emerald-400 transition-all"
              style={{ width: `${Math.round(Math.max(0, entry.progress) * 100)}%` }}
            />
          </div>
        </div>
      ) : (
        <button
          onClick={() => void post(clip.id, spaceId)}
          disabled={!spaceId}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-400 transition hover:bg-emerald-500/25 disabled:opacity-40"
        >
          <Send size={13} />
          Post to WorkVivo
        </button>
      )}

      {entry?.status === 'done' && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-400">
          <span className="flex items-center gap-1.5">
            <Check size={13} /> Posted to WorkVivo
          </span>
          <span className="flex items-center gap-2">
            {entry.permalink && (
              <a
                href={entry.permalink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 underline decoration-emerald-500/40 underline-offset-2 hover:text-emerald-300"
              >
                View <ExternalLink size={11} />
              </a>
            )}
            <button onClick={() => clear(clip.id)} className="text-emerald-400/70 hover:text-emerald-300">
              <X size={12} />
            </button>
          </span>
        </div>
      )}
      {entry?.status === 'error' && (
        <div className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-[11px] leading-relaxed text-red-400">
          {entry.error}
          <button onClick={() => clear(clip.id)} className="ml-2 underline hover:text-red-300">
            dismiss
          </button>
        </div>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
        Renders the clip and uploads it with the caption above as the post text.
      </p>
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
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-surface-600 px-3 py-2.5 text-left text-xs font-medium text-zinc-300 transition hover:bg-surface-800"
    >
      {label}
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition ${checked ? 'bg-zinc-100' : 'bg-surface-600'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${checked ? 'left-[18px] bg-zinc-900' : 'left-0.5 bg-white'}`}
        />
      </span>
    </button>
  )
}
