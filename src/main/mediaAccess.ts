import { resolve, sep } from 'node:path'
import { app } from 'electron'

/**
 * Allowlist for the media:// protocol. The sandboxed renderer may only read
 * files the app has a reason to show it: anything inside userData (project
 * thumbnails, B-roll images, downloaded source videos) plus the user-selected
 * source videos that live elsewhere on disk, which are registered explicitly
 * when a project is created or loaded.
 */

const allowedFiles = new Set<string>()

export function allowMediaPath(path: string): void {
  allowedFiles.add(resolve(path))
}

export function isMediaPathAllowed(path: string): boolean {
  const full = resolve(path)
  if (allowedFiles.has(full)) return true
  const userData = resolve(app.getPath('userData'))
  return full === userData || full.startsWith(userData + sep)
}
