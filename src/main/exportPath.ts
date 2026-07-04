import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function sanitizeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex -- control chars are invalid in Windows file names
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim()
  return (cleaned || 'clip').slice(0, 80)
}

/**
 * First non-colliding output path: "<base>.mp4", then "<base> (2).mp4", …
 * Two clips often share a title, and silently overwriting an earlier export
 * is never what the user wants.
 */
export function uniqueOutputPath(
  dir: string,
  baseName: string,
  exists: (p: string) => boolean = existsSync
): string {
  const first = join(dir, `${baseName}.mp4`)
  if (!exists(first)) return first
  for (let n = 2; ; n++) {
    const candidate = join(dir, `${baseName} (${n}).mp4`)
    if (!exists(candidate)) return candidate
  }
}
