/**
 * Initial window sizing: a comfortable floating window rather than an
 * edge-to-edge one. ~84% of the display's work area leaves visible margin on
 * every screen, clamped so huge monitors don't get a sprawling window and
 * small laptops never fall below the layout's minimum. Pure and separate
 * from main/index.ts so it can be unit tested outside Electron.
 */

export const MIN_WINDOW = { width: 1080, height: 700 }
const MAX_WINDOW = { width: 1600, height: 1000 }
const WORK_AREA_FRACTION = 0.84

export function initialWindowSize(workArea: { width: number; height: number }): {
  width: number
  height: number
} {
  return {
    width: Math.max(
      MIN_WINDOW.width,
      Math.min(MAX_WINDOW.width, Math.round(workArea.width * WORK_AREA_FRACTION))
    ),
    height: Math.max(
      MIN_WINDOW.height,
      Math.min(MAX_WINDOW.height, Math.round(workArea.height * WORK_AREA_FRACTION))
    )
  }
}
