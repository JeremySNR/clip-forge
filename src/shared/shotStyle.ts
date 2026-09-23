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
      // A face in a live blob that is not a rectangle is a person on a still
      // (often heavily compressed) camera background, not a webcam panel.
      const panel = samplePanel(sample, inset)
      return panel ? { ...base, style: 'screen-with-presenter', inset: panel } : { ...base, style: 'single-speaker' }
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

/** A cell must be live in this share of samples to belong to a webcam panel. */
const PERSISTENT_SHARE = 0.66
/** Presenter panels are rectangles: a person moving on a still background is not. */
const PANEL_MIN_FILL = 0.8
/** Per-pixel change frequency marking a panel edge: inside above, outside below. */
const EDGE_INSIDE = 0.2
const EDGE_OUTSIDE = 0.06
/** Pixels either side of a refined edge compared for a hard panel boundary. */
const EDGE_STEP = 3
/** Share of each panel side that must change in at least one sample. */
const PANEL_EDGE_COVERAGE = 0.6

/**
 * A fixed webcam panel over screen content, located from several samples.
 *
 * One sample cannot tell a webcam from content that happens to change: a
 * page scrolls, a demo video plays, a cursor drags a window. Across samples
 * the webcam is live every time while content changes come and go, so the
 * panel is the compact, rectangular region live in most samples that holds a
 * face in most samples. Several candidates (a primary commentator plus an
 * embedded video call) prefer the one anchored to the frame edges, as
 * overlays are, then the one with the most face detections.
 *
 * Bounds are refined from cells to sample pixels using per-pixel change
 * frequency, and every side not on the frame border must be a hard edge.
 * That rejects a person on a still, heavily compressed camera background,
 * whose live region fades out gradually instead of stopping at a line.
 */
export function persistentPresenterInset(samples: StyleSample[]): ContentRegion | undefined {
  if (samples.length < 2) return undefined
  const { width, height } = samples[0]
  if (samples.some(s => s.width !== width || s.height !== height)) return undefined
  const grids = samples.map(cellGrid)
  const { cols, rows } = grids[0]
  const need = Math.ceil(PERSISTENT_SHARE * samples.length)
  const persistent = grids[0].cells.map((_, i) => grids.filter(g => !g.cells[i].still).length >= need)
  // Per-pixel change frequency across samples.
  const frequency = new Float32Array(width * height)
  for (const { a, b } of samples) for (let i = 0; i < frequency.length; i++) if (Math.abs(a[i] - b[i]) > REPEAT_DELTA) frequency[i]++
  for (let i = 0; i < frequency.length; i++) frequency[i] /= samples.length

  const seen = new Uint8Array(persistent.length)
  let best: { score: number; region: ContentRegion } | undefined
  for (let start = 0; start < persistent.length; start++) {
    if (seen[start] || !persistent[start]) continue
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
        if (!seen[n] && persistent[n]) { seen[n] = 1; stack.push(n) }
      }
    }
    const w = c1 - c0 + 1, h = r1 - r0 + 1
    const area = (w * h) / (cols * rows)
    if (area < INSET_MIN_AREA || area > INSET_MAX_AREA || count / (w * h) < PANEL_MIN_FILL) continue
    const region = refinePanel(frequency, width, height,
      Math.max(0, (c0 - 1) * CELL), Math.min(width, (c1 + 2) * CELL), Math.max(0, (r0 - 1) * CELL), Math.min(height, (r1 + 2) * CELL))
    if (!region) continue
    const hits = samples.filter(s => s.faces.some(f => faceHeight(f) >= MIN_FACE && inside(region, centreX(f), centreY(f)))).length
    if (hits < Math.ceil(samples.length / 2)) continue
    const anchored = [region.x < .02, region.y < .02, region.x + region.width > .98, region.y + region.height > .98].filter(Boolean).length
    const score = hits + 2 * Math.min(2, anchored)
    if (!best || score > best.score) best = { score, region }
  }
  return best?.region
}

/** Pixel-precise panel bounds around one sample's live cell region, if it is a rectangle. */
function samplePanel(sample: StyleSample, cells: ContentRegion): ContentRegion | undefined {
  const { width, height, a, b } = sample
  const frequency = new Float32Array(width * height)
  for (let i = 0; i < frequency.length; i++) if (Math.abs(a[i] - b[i]) > REPEAT_DELTA) frequency[i] = 1
  return refinePanel(frequency, width, height,
    Math.max(0, Math.floor(cells.x * width) - CELL), Math.min(width, Math.ceil((cells.x + cells.width) * width) + CELL),
    Math.max(0, Math.floor(cells.y * height) - CELL), Math.min(height, Math.ceil((cells.y + cells.height) * height) + CELL))
}

/** Pixel bounds from change-frequency profiles; undefined without hard internal edges. */
function refinePanel(frequency: Float32Array, width: number, height: number,
  x0: number, x1: number, y0: number, y1: number): ContentRegion | undefined {
  const column = (x: number): number => {
    if (x < 0 || x >= width) return 0
    let sum = 0
    for (let y = y0; y < y1; y++) sum += frequency[y * width + x]
    return sum / Math.max(1, y1 - y0)
  }
  const row = (y: number): number => {
    if (y < 0 || y >= height) return 0
    let sum = 0
    for (let x = x0; x < x1; x++) sum += frequency[y * width + x]
    return sum / Math.max(1, x1 - x0)
  }
  const bounds = (profile: (i: number) => number, from: number, to: number): [number, number] | undefined => {
    let lo = -1, hi = -1
    for (let i = from; i < to; i++) if (profile(i) >= EDGE_INSIDE) { if (lo < 0) lo = i; hi = i }
    return lo < 0 ? undefined : [lo, hi + 1]
  }
  const xs = bounds(column, x0, x1), ys = bounds(row, y0, y1)
  if (!xs || !ys) return undefined
  // Profiles averaged over the panel's own span, so a neighbouring live
  // region outside it does not blur the edge.
  const hard = (profile: (i: number) => number, edge: number, outward: number, limit: number): boolean =>
    edge <= 0 || edge >= limit ||
    (profile(edge + outward * EDGE_STEP) <= EDGE_OUTSIDE && profile(edge - outward * (EDGE_STEP + 1)) >= EDGE_INSIDE)
  x0 = xs[0]; x1 = xs[1]; y0 = ys[0]; y1 = ys[1]
  if (!hard(column, x0, -1, width) || !hard(column, x1 - 1, 1, width - 1) ||
      !hard(row, y0, -1, height) || !hard(row, y1 - 1, 1, height - 1)) return undefined
  // A panel is live along the whole of each side; a rounded blob (a head on
  // a still background) only touches its bounding box at a few points.
  const inset = EDGE_STEP - 1
  const coveredColumn = (x: number): number => {
    let live = 0
    for (let y = y0; y < y1; y++) if (frequency[y * width + x] > 0) live++
    return live / Math.max(1, y1 - y0)
  }
  const coveredRow = (y: number): number => {
    let live = 0
    for (let x = x0; x < x1; x++) if (frequency[y * width + x] > 0) live++
    return live / Math.max(1, x1 - x0)
  }
  if (x1 - x0 <= 2 * inset || y1 - y0 <= 2 * inset ||
      Math.min(coveredColumn(x0 + inset), coveredColumn(x1 - 1 - inset),
        coveredRow(y0 + inset), coveredRow(y1 - 1 - inset)) < PANEL_EDGE_COVERAGE) return undefined
  return { x: x0 / width, y: y0 / height, width: (x1 - x0) / width, height: (y1 - y0) / height }
}

/**
 * The largest part of the frame beside a presenter panel: the content left,
 * right, above or below it. A fallback when nothing better says which part
 * of the screen matters.
 */
export function contentBesideInset(inset: ContentRegion): ContentRegion {
  const options: ContentRegion[] = [
    { x: 0, y: 0, width: inset.x, height: 1 },
    { x: inset.x + inset.width, y: 0, width: 1 - inset.x - inset.width, height: 1 },
    { x: 0, y: 0, width: 1, height: inset.y },
    { x: 0, y: inset.y + inset.height, width: 1, height: 1 - inset.y - inset.height }
  ]
  return options.reduce((p, q) => (q.width * q.height > p.width * p.height ? q : p))
}

/**
 * Trim a content rectangle so it no longer covers the presenter panel,
 * cutting along whichever side of the panel loses the least content.
 */
export function excludeInset(content: ContentRegion, inset: ContentRegion): ContentRegion {
  const right = content.x + content.width, bottom = content.y + content.height
  const ix = Math.min(right, inset.x + inset.width) - Math.max(content.x, inset.x)
  const iy = Math.min(bottom, inset.y + inset.height) - Math.max(content.y, inset.y)
  if (ix <= 0 || iy <= 0) return content
  const options: ContentRegion[] = [
    { x: content.x, y: content.y, width: inset.x - content.x, height: content.height },
    { x: inset.x + inset.width, y: content.y, width: right - inset.x - inset.width, height: content.height },
    { x: content.x, y: content.y, width: content.width, height: inset.y - content.y },
    { x: content.x, y: inset.y + inset.height, width: content.width, height: bottom - inset.y - inset.height }
  ].filter(r => r.width > 0 && r.height > 0)
  return options.reduce((p, q) => (q.width * q.height > p.width * p.height ? q : p), options[0] ?? content)
}

/** Aggregate per-sample styles into one clip decision. */
export function classifyClipStyle(samples: StyleSample[]): ClipStyle {
  const results = samples.map(classifySample)
  if (!results.length) return { style: 'mixed', recommendation: 'wide-fit', confidence: 0, smallFaces: false, samples: [] }
  // A persistent webcam panel decides the clip even when scrolling or a
  // playing video makes individual samples look like camera footage.
  const panel = persistentPresenterInset(samples)
  if (panel) {
    const agreeing = results.filter(r => r.style === 'screen-with-presenter' || r.style === 'screen').length
    return { style: 'screen-with-presenter', recommendation: 'content-with-presenter',
      confidence: Math.max(agreeing, Math.ceil(PERSISTENT_SHARE * results.length)) / results.length,
      inset: panel, smallFaces: false, samples: results }
  }
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
