import type { ContentRegion } from '@shared/types'
import { validRectangle } from '@shared/composition'

/** Conservative veto for reusing screen crops. A contrast feature touching a
 * crop edge may be a cut label/axis. It is not a general-purpose text detector;
 * a veto requests a fresh proposal rather than declaring the video unusable.
 * Input is a 640×360 grayscale source thumbnail, regardless of source aspect. */
export function cutsContentEdge(pixels: Uint8Array, region: ContentRegion): boolean {
  if (pixels.length !== 640 * 360 || !validRectangle(region)) return true
  const left = Math.floor(region.x * 640), right = Math.min(639, Math.ceil((region.x + region.width) * 640) - 1)
  const top = Math.floor(region.y * 360), bottom = Math.min(359, Math.ceil((region.y + region.height) * 360) - 1)
  for (const [horizontal, position, from, until, limit] of [
    [1, top, left, right, 360], [1, bottom, left, right, 360],
    [0, left, top, bottom, 640], [0, right, top, bottom, 640]
  ]) {
    // Touching the source boundary does not discard any additional content.
    if (position < 3 || position > limit - 4) continue
    const at = (along: number, across: number): number => horizontal
      ? pixels[Math.max(0, Math.min(359, across)) * 640 + along]
      : pixels[along * 640 + Math.max(0, Math.min(639, across))]
    const surroundings: number[] = []
    for (let n = from; n <= until; n++) surroundings.push(at(n, position - 6), at(n, position + 6))
    surroundings.sort((a, b) => a - b)
    const background = surroundings[Math.floor(surroundings.length / 2)]
    for (const offset of [-1, 0, 1]) {
      let count = 0, run = 0, longest = 0
      for (let n = from; n <= until; n++) {
        if (Math.abs(at(n, position + offset) - background) > 40) {
          count++; run++; longest = Math.max(longest, run)
        } else run = 0
      }
      if (count / (until - from + 1) > .015 && longest >= 3) return true
    }
  }
  return false
}
