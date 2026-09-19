import type { Clip, ClipContentType, ClipEditState, VideoType } from './types'
import { DETAIL_CAPTION_Y, validContentRegion, type CaptionPositionRange } from './contentRegion'

/** Face coverage below this is treated as a screencast / demo / slides clip. */
export const SCREENCAST_FACE_COVERAGE = 0.25

export function classifyClipContent(faceCoverage: number, hasFocusTrack = true): ClipContentType {
  if (!hasFocusTrack) return 'screencast'
  if (faceCoverage < SCREENCAST_FACE_COVERAGE) return 'screencast'
  return 'speaker'
}

/** Layout defaults for demos and screen shares on vertical exports. */
export function editDefaultsForContentType(
  edit: ClipEditState,
  contentType: ClipContentType
): ClipEditState {
  if (contentType !== 'screencast') return edit
  return {
    ...edit,
    reframeMode: 'fit-letterbox',
    framing: 'manual',
    focusX: 0.5,
    autoZoom: false
  }
}

/** Auto zoom only makes sense on cropped talking-head reframes. */
export function clipAllowsAutoZoom(edit: ClipEditState): boolean {
  return (edit.autoZoom ?? false) && edit.reframeMode === 'crop'
}

/** A detected face must not overrule an inspected slide, prop or demonstration. */
export function applyVisualLayout(
  edit: ClipEditState,
  assessment: Clip['visualLayout'],
  videoType: VideoType
): ClipEditState {
  if (!assessment || edit.start < assessment.start - 0.001 || edit.end > assessment.end + 0.001) return edit
  // Explicit talking-head mode is a user choice; automatic mode may prefer context.
  if (assessment.preserveContext && videoType !== 'talking-head') {
    if (validLayoutShots(assessment, edit.start, edit.end) &&
      assessment.shots!.some(shot => (shot.mode === 'crop' || validContentRegion(shot.region, shot.overview)) && shot.start < edit.end && shot.end > edit.start)) {
      return { ...edit, reframeMode: 'crop', framing: 'auto', autoZoom: false }
    }
    return { ...edit, reframeMode: 'fit-letterbox', framing: 'manual', focusX: 0.5, autoZoom: false }
  }
  return assessment.allowZoom ? edit : { ...edit, autoZoom: false }
}

export function validLayoutShots(assessment: Clip['visualLayout'], start: number, end: number): boolean {
  if (!assessment?.shots?.length || !Number.isFinite(assessment.start) || !Number.isFinite(assessment.end) ||
    assessment.shots.length > 48 || start < assessment.start - 0.001 || end > assessment.end + 0.001) return false
  let cursor = assessment.start
  for (const shot of assessment.shots) {
    if (!Number.isFinite(shot.start) || !Number.isFinite(shot.end) || shot.end <= shot.start ||
      Math.abs(shot.start - cursor) > 0.001 || (shot.mode !== 'crop' && shot.mode !== 'fit') ||
      (shot.overview !== undefined && typeof shot.overview !== 'boolean') ||
      (shot.overview && (!shot.region || shot.mode !== 'fit')) ||
      (shot.region !== undefined && !validContentRegion(shot.region, shot.overview))) return false
    cursor = shot.end
  }
  return Math.abs(cursor - assessment.end) <= 0.001
}

/** Retain the full scene where face detail cannot support a reliable close-up. */
export function protectLayoutRanges(
  assessment: Clip['visualLayout'], start: number, end: number,
  ranges: Array<{ start: number; end: number }>
): Clip['visualLayout'] {
  const protectedRanges = ranges.filter(r => Number.isFinite(r.start) && Number.isFinite(r.end) &&
    r.end > r.start && r.start < end && r.end > start)
  if (!protectedRanges.length) return assessment
  const baseShots = validLayoutShots(assessment, start, end) ? assessment!.shots! : []
  const wholeFit = !baseShots.length && assessment?.preserveContext &&
    start >= assessment.start - 0.001 && end <= assessment.end + 0.001
  const times = [...protectedRanges, ...baseShots].flatMap(r => [r.start, r.end])
  const bounds = [start, ...new Set(times.filter(t => t > start && t < end))].sort((a, b) => a - b)
  bounds.push(end)
  const shots = bounds.slice(0, -1).map((from, i) => {
    const until = bounds[i + 1]
    const base = baseShots.find(r => from >= r.start && until <= r.end)
    // An inspected object region is independent of confidence in the speaking face.
    const region = base?.mode === 'fit' ? base.region : undefined
    return { start: from, end: until, ...(region ? { region, ...(base?.overview ? { overview: true } : {}) } : {}),
      mode: (wholeFit || protectedRanges.some(r => from < r.end && until > r.start) || base?.mode === 'fit' ? 'fit' : 'crop') as 'fit' | 'crop' }
  })
  return {
    start, end, preserveContext: true, allowZoom: false,
    reason: [assessment?.reason, 'Preserve shots with insufficient face detail for reliable speaker framing.'].filter(Boolean).join(' '),
    shots: shots.length <= 48 ? shots : [{ start, end, mode: 'fit' }]
  }
}

/** Manual framing and layout choices always override automatic shot composition. */
export function automaticLayoutShots(clip: Pick<Clip, 'edit' | 'visualLayout'>): NonNullable<NonNullable<Clip['visualLayout']>['shots']> {
  if (clip.edit.framing !== 'auto' || clip.edit.reframeMode !== 'crop' || clip.edit.aspect === 'original' ||
    !validLayoutShots(clip.visualLayout, clip.edit.start, clip.edit.end)) return []
  const regions = new Set<string>()
  return clip.visualLayout!.shots!.filter((shot) => shot.start < clip.edit.end && shot.end > clip.edit.start).map(shot => {
    if (!shot.region || shot.mode !== 'fit') return shot
    const key = JSON.stringify([shot.region, shot.overview ?? false])
    // Bound the number of full-resolution render branches; use full fit beyond it.
    if (!regions.has(key) && regions.size >= 8) return { ...shot, region: undefined, overview: undefined }
    regions.add(key)
    return shot
  })
}

export function detailCaptionRanges(clip: Pick<Clip, 'edit' | 'visualLayout'>): CaptionPositionRange[] {
  return automaticLayoutShots(clip).filter(shot => shot.overview && shot.region)
    .map(shot => ({ start: shot.start, end: shot.end, positionY: DETAIL_CAPTION_Y }))
}

/** Avoid a one-frame fit flash when both sides of a transition are safe crops. */
export function bridgeTransitionLayouts(
  shots: NonNullable<NonNullable<Clip['visualLayout']>['shots']>,
  transitions: Array<{ start: number; end: number }>
): void {
  const isTransition = shots.map((shot) => transitions.some((range) => shot.start < range.end && shot.end > range.start))
  for (let i = 0; i < shots.length; i++) {
    if (!isTransition[i]) continue
    let left = i - 1, right = i + 1
    while (left >= 0 && isTransition[left]) left--
    while (right < shots.length && isTransition[right]) right++
    if (left >= 0 && right < shots.length && shots[left].mode === 'crop' && shots[right].mode === 'crop') shots[i].mode = 'crop'
  }
}
