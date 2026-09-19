import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** Keep existing absolute media paths valid; new installs use the new name. */
export function resolveUserDataPath(
  appData: string,
  override?: string,
  exists: (path: string) => boolean = existsSync
): string {
  if (override) return resolve(override)
  const current = join(appData, 'cutawan')
  const hasData = (dir: string): boolean =>
    exists(join(dir, 'settings.json')) || exists(join(dir, 'projects'))
  if (hasData(current)) return current
  // Compatibility only: never rename/move a user's media or encrypted settings.
  for (const previousName of ['clipforge', 'ClipForge']) {
    const previous = join(appData, previousName)
    if (hasData(previous)) return previous
  }
  return current
}
