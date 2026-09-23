import type { ContentRegion } from './types'

/**
 * Fast, local shot-style triage: which reframing primitive a clip most
 * likely needs, from a handful of sampled frame pairs and face boxes.
 *
 * The existing layout route learns the source style from expensive evidence:
 * a cloud vision review of six frames decides screen vs camera and proposes
 * webcam-inset rectangles, and dense 25 fps active-speaker analysis decides
 * speaker vs screencast afterwards. Both are slow, and the first needs a
 * connection. The cues that separate the common short-form source styles are
 * cheap and local instead:
 *
 * - **Temporal pixel stillness.** Screen recordings encode unchanged UI as
 *   skip blocks, so decoded pixels repeat exactly between neighbouring frames.
 *   Camera footage carries sensor and codec noise even on a tripod. Frames
 *   are point-sampled (never averaged) so that noise survives downscaling.
 * - **A live rectangle inside a still screen** is a webcam inset. Its bounds
 *   come straight from the pixels, wherever the inset sits.
 * - **Straight still dividers between faces** mark a remote-call gallery
 *   (Zoom, Riverside, StreamYard tiles) rather than people sharing one shot.
 * - **Face count and size** separate a single speaker, a two-shot and a
 *   group, and say whether a close crop has enough detail.
 *
 * Everything here is pure and deterministic; main/pipeline/shotTriage.ts
 * supplies the frames. Thresholds are provisional engineering choices checked
 * on synthetic fixtures, not calibrated against labelled footage.
 */

export type ShotStyle =
  | 'single-speaker'
  | 'two-shot'
  | 'group'
  | 'gallery'
  | 'screen'
  | 'screen-with-presenter'
  | 'no-face'

/** The reframing primitive a style most likely needs. */
export type LayoutRecommendation =
  /** Follow one face with a tracked 9:16 crop; auto zoom is reasonable. */
  | 'speaker-crop'
  /** Follow the active speaker; stack both people during quick exchanges. */
  | 'speaker-crop-with-splits'
  /** Crop to individual call tiles and follow the active speaker's tile. */
  | 'gallery-tiles'
  /** Screen content region plus the webcam inset as a separate panel. */
  | 'content-with-presenter'
  /** Fit the screen content intact, optionally with an enlarged detail. */
  | 'content-fit'
  /** Keep the wide scene (blurred fill), no reliable subject to follow. */
  | 'wide-fit'

/** Minimal face box shape (normalized 0..1), compatible with pipeline FaceBox. */
export interface StyleFace { x1: number; y1: number; x2: number; y2: number; score: number }

/** Two neighbouring decoded frames (luma, point-sampled) and the faces in the first. */
export interface StyleSample {
  width: number
  height: number
  a: Uint8Array
  b: Uint8Array
  faces: StyleFace[]
}

export interface SampleStyle {
  style: ShotStyle
  /** Share of analysis cells whose pixels repeat exactly between the two frames. */
  stillShare: number
  faceCount: number
  /** Height of the largest counted face as a share of frame height. */
  largestFace: number
  /**
   * Live rectangle inside a still screen: the webcam inset for
   * screen-with-presenter, otherwise playing video, scrolling or animation.
   */
  inset?: ContentRegion
}

export interface ClipStyle {
  style: ShotStyle | 'mixed'
  recommendation: LayoutRecommendation
  /** Share of samples agreeing with `style` (0..1). */
  confidence: number
  /** Median inset across agreeing samples, for screen-with-presenter. */
  inset?: ContentRegion
  /** Faces too small for a sharp close crop (under SMALL_FACE of frame height). */
  smallFaces: boolean
  samples: SampleStyle[]
}

/** Analysis cell edge in sample pixels. */
const CELL = 6
/** A pixel repeats when its value changes by at most this much. */
const REPEAT_DELTA = 1
/**
 * A cell is still when this share of its pixels repeat exactly; anything
 * else is live (camera noise or motion). Encoded insets mix strongly and
 * weakly changing cells, so a second "clearly live" level fragments them.
 */
const STILL_CELL = 0.92
/** A frame is screen-like when most cells are still. */
const SCREEN_STILL_SHARE = 0.55
/** Ignore faces below this height (distant crowd, photos inside slides). */
const MIN_FACE = 0.035
/** Faces below this height make a close 9:16 crop soft or distant. */
export const SMALL_FACE = 0.09
/** Inset area bounds as a share of the frame, and minimum bbox fill. */
const INSET_MIN_AREA = 0.008
const INSET_MAX_AREA = 0.45
const INSET_MIN_FILL = 0.6
/** A divider line must run this share of the frame. */
const DIVIDER_SPAN = 0.85
/** Samples must agree this much for a single style. */
const AGREEMENT = 0.6

interface CellStats { still: boolean }

function cellGrid(sample: StyleSample): { cols: number; rows: number; cells: CellStats[] } {
  const { width, height, a, b } = sample
  const cols = Math.max(1, Math.floor(width / CELL)), rows = Math.max(1, Math.floor(height / CELL))
  const cells: CellStats[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let repeat = 0, count = 0
      for (let y = r * CELL; y < (r + 1) * CELL; y++) {
        const row = y * width
        for (let x = c * CELL; x < (c + 1) * CELL; x++) {
          if (Math.abs(a[row + x] - b[row + x]) <= REPEAT_DELTA) repeat++
          count++
        }
      }
      const share = repeat / count
      cells.push({ still: share >= STILL_CELL })
    }
  }
  return { cols, rows, cells }
}

/**
 * Largest connected region of live cells, as a normalized rectangle, when it
 * is compact enough to be an inset. 4-connected flood fill over the grid.
 */
export function liveInset(sample: StyleSample): ContentRegion | undefined {
  const { cols, rows, cells } = cellGrid(sample)
  const seen = new Uint8Array(cells.length)
  let best: { count: number; c0: number; c1: number; r0: number; r1: number } | undefined
  for (let start = 0; start < cells.length; start++) {
    if (seen[start] || cells[start].still) continue
    const stack = [start]
    seen[start] = 1
    let count = 0, c0 = cols, c1 = -1, r0 = rows, r1 = -1
    while (stack.length) {
      const i = stack.pop()!
      const c = i % cols, r = Math.floor(i / cols)
      count++
      c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r)
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue
        const n = nr * cols + nc
        if (!seen[n] && !cells[n].still) { seen[n] = 1; stack.push(n) }
      }
    }
    if (!best || count > best.count) best = { count, c0, c1, r0, r1 }
  }
  if (!best) return undefined
  const w = best.c1 - best.c0 + 1, h = best.r1 - best.r0 + 1
  const area = (w * h) / (cols * rows)
  if (area < INSET_MIN_AREA || area > INSET_MAX_AREA || best.count / (w * h) < INSET_MIN_FILL) return undefined
  return { x: best.c0 / cols, y: best.r0 / rows, width: w / cols, height: h / rows }
}

/**
 * Whether a straight, still divider separates the two given x (or y)
 * positions: a column (row) whose pixels repeat between frames along most of
 * its length and either stay uniform (a gutter) or mark a hard edge (tiles
 * meeting). Point-sampled camera noise keeps ordinary walls from qualifying.
 */
export function hasDivider(sample: StyleSample, axis: 'x' | 'y', from: number, to: number): boolean {
  const { width, height, a, b } = sample
  const length = axis === 'x' ? height : width
  const extent = axis === 'x' ? width : height
  const lo = Math.max(1, Math.ceil(Math.min(from, to) * extent)), hi = Math.min(extent - 2, Math.floor(Math.max(from, to) * extent))
  const at = (buf: Uint8Array, line: number, i: number): number =>
    axis === 'x' ? buf[i * width + line] : buf[line * width + i]
  for (let line = lo; line <= hi; line++) {
    let still = 0, edge = 0, uniform = 0
    const reference = at(a, line, Math.floor(length / 2))
    for (let i = 0; i < length; i++) {
      const v = at(a, line, i)
      if (Math.abs(v - at(b, line, i)) > REPEAT_DELTA) continue
      still++
      if (Math.abs(at(a, line - 1, i) - at(a, line + 1, i)) > 24) edge++
      if (Math.abs(v - reference) <= 6) uniform++
    }
    if (still >= DIVIDER_SPAN * length && Math.max(edge, uniform) >= DIVIDER_SPAN * length) return true
  }
  return false
}

const faceHeight = (f: StyleFace): number => f.y2 - f.y1
const centreX = (f: StyleFace): number => (f.x1 + f.x2) / 2
const centreY = (f: StyleFace): number => (f.y1 + f.y2) / 2

function inside(r: ContentRegion, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height
}

/** Tiles: every neighbouring pair of faces is separated by a still divider. */
function isGallery(sample: StyleSample, faces: StyleFace[]): boolean {
  if (faces.length < 2) return false
  const sorted = [...faces].sort((p, q) => centreX(p) - centreX(q))
  let separated = 0
  for (let i = 1; i < sorted.length; i++) {
    const p = sorted[i - 1], q = sorted[i]
    const sameRow = Math.abs(centreY(p) - centreY(q)) < Math.max(faceHeight(p), faceHeight(q))
    if (sameRow ? hasDivider(sample, 'x', p.x2, q.x1) : hasDivider(sample, 'y', Math.min(p.y2, q.y2), Math.max(p.y1, q.y1))) separated++
  }
  return separated >= Math.max(1, sorted.length - 1)
}

export function classifySample(sample: StyleSample): SampleStyle {
  const { cells } = cellGrid(sample)
  const stillShare = cells.filter(c => c.still).length / Math.max(1, cells.length)
  const faces = sample.faces.filter(f => faceHeight(f) >= MIN_FACE)
  const largestFace = faces.reduce((m, f) => Math.max(m, faceHeight(f)), 0)
  const base = { stillShare, faceCount: faces.length, largestFace }
  if (stillShare >= SCREEN_STILL_SHARE) {
    const inset = liveInset(sample)
    if (inset && faces.some(f => inside(inset, centreX(f), centreY(f)))) {
      return { ...base, style: 'screen-with-presenter', inset }
    }
    // A still frame can also be a gallery with frozen, silent tiles; faces
    // separated by dividers decide it. Otherwise faces are pictures on screen.
    if (isGallery(sample, faces)) return { ...base, style: 'gallery' }
    return { ...base, style: 'screen', ...(inset ? { inset } : {}) }
  }
  if (faces.length === 0) return { ...base, style: 'no-face' }
  if (isGallery(sample, faces)) return { ...base, style: 'gallery' }
  // One dominant face with small background figures is still a single speaker.
  const heights = faces.map(faceHeight).sort((p, q) => q - p)
  if (faces.length === 1 || heights[1] < heights[0] * 0.5) return { ...base, style: 'single-speaker' }
  return { ...base, style: faces.length === 2 ? 'two-shot' : 'group' }
}

export function recommendLayout(style: ShotStyle | 'mixed', smallFaces: boolean): LayoutRecommendation {
  switch (style) {
    case 'single-speaker': return smallFaces ? 'wide-fit' : 'speaker-crop'
    case 'two-shot': return 'speaker-crop-with-splits'
    // A wide group only supports a close crop when faces carry enough detail.
    case 'group': return smallFaces ? 'wide-fit' : 'speaker-crop-with-splits'
    case 'gallery': return 'gallery-tiles'
    case 'screen-with-presenter': return 'content-with-presenter'
    case 'screen': return 'content-fit'
    case 'no-face':
    case 'mixed': return 'wide-fit'
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

/** Aggregate per-sample styles into one clip decision. */
export function classifyClipStyle(samples: StyleSample[]): ClipStyle {
  const results = samples.map(classifySample)
  if (!results.length) return { style: 'mixed', recommendation: 'wide-fit', confidence: 0, smallFaces: false, samples: [] }
  const votes = new Map<ShotStyle, number>()
  for (const r of results) votes.set(r.style, (votes.get(r.style) ?? 0) + 1)
  const [top, count] = [...votes.entries()].sort((p, q) => q[1] - p[1])[0]
  const confidence = count / results.length
  const style = confidence >= AGREEMENT ? top : 'mixed'
  const agreeing = results.filter(r => r.style === top)
  const faced = agreeing.filter(r => r.faceCount > 0)
  const smallFaces = faced.length > 0 && median(faced.map(r => r.largestFace)) < SMALL_FACE
  const insets = agreeing.flatMap(r => r.inset ? [r.inset] : [])
  const inset = style === 'screen-with-presenter' && insets.length ? {
    x: median(insets.map(r => r.x)), y: median(insets.map(r => r.y)),
    width: median(insets.map(r => r.width)), height: median(insets.map(r => r.height))
  } : undefined
  return { style, recommendation: recommendLayout(style, smallFaces), confidence, inset, smallFaces, samples: results }
}
