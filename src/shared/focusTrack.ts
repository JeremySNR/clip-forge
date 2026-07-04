import type { FocusKeyframe } from './types'

/** Sample a piecewise-constant focus track at a given source time. */
export function focusAt(track: FocusKeyframe[], t: number): number {
  let x = track[0]?.x ?? 0.5
  for (const kf of track) {
    if (kf.t <= t) x = kf.x
    else break
  }
  return x
}
