import { useState } from 'react'
import type { Clip, Composition, ContentRegion } from '@shared/types'
import { presenterComposition } from '@shared/composition'
import { compositionHidesTitle, layoutReviewMessage, validLayoutShots } from '@shared/contentType'
import { usePreviewBus } from '../lib/previewBus'
import { useStore } from '../store'

const preferences = [
  ['auto', 'Automatic'], ['content-first', 'Content first'], ['stacked', 'Stacked'], ['content-only', 'Content only']
] as const
const startingRegions = presenterComposition({ x: .05, y: .35, width: .75, height: .6 },
  { x: .82, y: .02, width: .16, height: .28 })!

export default function CompositionControls({ clip }: { clip: Clip }): React.JSX.Element | null {
  const [adding, setAdding] = useState(false)
  const shot = usePreviewBus(s => clip.visualLayout?.shots?.find(shot => s.time >= shot.start && s.time < shot.end))
  const update = useStore(s => s.updateClip)
  const hasComposition = clip.visualLayout?.shots?.some(s => s.composition)
  const issue = layoutReviewMessage(clip)
  const active = clip.edit.aspect === '9:16' && clip.edit.framing === 'auto' && clip.edit.reframeMode === 'crop'
  const saveRegions = (composition: Composition): void => {
    const layout = clip.visualLayout
    const existing = validLayoutShots(layout, clip.edit.start, clip.edit.end)
    const replacement = { start: shot?.start ?? clip.edit.start, end: shot?.end ?? clip.edit.end, mode: 'fit' as const,
      composition, review: { status: 'needs-review' as const, reason: 'Source regions adjusted manually; review this shot before exporting.' } }
    void update({ ...clip, edit: { ...clip.edit, framing: 'auto', reframeMode: 'crop', autoZoom: false },
      visualLayout: { start: existing ? layout!.start : clip.edit.start, end: existing ? layout!.end : clip.edit.end,
        preserveContext: true, allowZoom: false, reason: 'Manually selected source regions.', revision: (layout?.revision ?? 0) + 1,
        shots: existing && shot ? layout!.shots!.map(s => s === shot ? replacement : s)
          : [{ ...replacement, start: clip.edit.start, end: clip.edit.end }] } })
    setAdding(false)
  }
  return <div className="mt-3 space-y-2">
    {issue && <p className="text-xs text-amber-300">Review layout: {issue}</p>}
    {hasComposition && <>
      <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Presenter and content layout">
        {preferences.map(([value, label]) => <button key={value} type="button"
          aria-pressed={active && (clip.edit.compositionPreference ?? 'auto') === value}
          disabled={clip.edit.aspect !== '9:16'}
          onClick={() => void update({ ...clip, edit: { ...clip.edit, compositionPreference: value, framing: 'auto', reframeMode: 'crop', autoZoom: false } })}
          className={`rounded-lg border px-2 py-2 text-xs transition disabled:opacity-40 ${active && (clip.edit.compositionPreference ?? 'auto') === value ? 'border-white/30 bg-white/[0.07] text-zinc-100' : 'border-surface-600 text-zinc-400 hover:bg-surface-800'}`}>
          {label}
        </button>)}
      </div>
      <p className="text-[11px] leading-relaxed text-zinc-500">
        {clip.edit.aspect !== '9:16' ? 'Presenter layouts are available in 9:16. Other formats keep the full scene.' :
          'Separate crops from the original video. Automatic layouts are checked on sampled frames; review motion before exporting.'}
      </p>
      {compositionHidesTitle(clip) && clip.edit.showTitle && <p className="text-[11px] text-zinc-500">The hook title is hidden to keep the presenter clear.</p>}
      {active && shot?.composition && <RegionForm key={`${shot.start}:${JSON.stringify(shot.composition)}`}
        composition={shot.composition} onSave={saveRegions} />}
    </>}
    {clip.edit.aspect === '9:16' && !shot?.composition && <>
      <button type="button" className="text-xs text-zinc-400 underline underline-offset-4" onClick={() => setAdding(!adding)}>
        {adding ? 'Cancel source regions' : 'Set presenter and content regions'}
      </button>
      {adding && <>
        <p className="text-[11px] text-zinc-500">For a separate presenter inset and screen content. Adjust these starting regions to match your source; no AI analysis is needed.</p>
        <RegionForm composition={startingRegions} onSave={saveRegions} open />
      </>}
    </>}
  </div>
}

function RegionForm({ composition, onSave, open }: { composition: Composition; onSave: (composition: Composition) => void; open?: boolean }): React.JSX.Element {
  const [error, setError] = useState('')
  return <details open={open} className="text-xs text-zinc-400"><summary className="cursor-pointer py-1">Adjust source regions for this shot</summary>
    <form className="mt-2 space-y-3" onSubmit={event => {
      event.preventDefault()
      const values = new FormData(event.currentTarget)
      const regions: Record<string, ContentRegion> = Object.fromEntries(composition.layers.map(layer => {
        const value = (field: string): number => Number(values.get(`${layer.role}-${field}`)) / 100
        return [layer.role, { x: value('x'), y: value('y'), width: value('width'), height: value('height') }]
      }))
      const updated = regions.presenter && presenterComposition(regions.content, regions.presenter, composition.preset)
      if (!updated) { setError('Keep both regions inside the source and avoid overlapping the presenter with the content.'); return }
      setError('')
      onSave(updated)
    }}>
      {composition.layers.map(layer => <fieldset key={layer.role}>
        <legend className="mb-1 capitalize">{layer.role} (% of source)</legend>
        <div className="grid grid-cols-4 gap-1">
          {(['x', 'y', 'width', 'height'] as const).map(field => <label key={field} className="text-[10px]">
            {field}<input name={`${layer.role}-${field}`} type="number" required min={0} max={100} step={.1}
              defaultValue={Number((layer.source[field] * 100).toFixed(1))}
              className="mt-1 w-full rounded border border-surface-600 bg-surface-850 p-1 text-xs text-zinc-200" />
          </label>)}
        </div>
      </fieldset>)}
      {error && <p role="alert" className="text-amber-300">{error}</p>}
      <button type="submit" className="rounded border border-surface-600 px-3 py-1.5 text-zinc-200">Apply regions</button>
    </form>
  </details>
}
