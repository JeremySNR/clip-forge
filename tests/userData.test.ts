import { describe, expect, it } from 'vitest'
import { join, resolve } from 'node:path'
import { resolveUserDataPath } from '../src/main/userData'

describe('user data continuity across the rename', () => {
  const root = resolve('test-app-data')
  const withFiles = (...files: string[]) => (path: string): boolean => files.includes(path)

  it('uses the new directory for a new installation', () => {
    expect(resolveUserDataPath(root, undefined, () => false)).toBe(join(root, 'cutawan'))
  })

  it('retains existing projects at their absolute paths', () => {
    const legacy = join(root, 'clipforge')
    expect(resolveUserDataPath(root, undefined, withFiles(join(legacy, 'projects')))).toBe(legacy)
  })

  it('retains settings-only installations and case-sensitive product-name directories', () => {
    const legacy = join(root, 'ClipForge')
    expect(resolveUserDataPath(root, undefined, withFiles(join(legacy, 'settings.json')))).toBe(legacy)
  })

  it('prefers populated new data when both installations exist', () => {
    const current = join(root, 'cutawan')
    expect(resolveUserDataPath(root, undefined, withFiles(
      join(current, 'projects'), join(root, 'clipforge', 'projects')
    ))).toBe(current)
  })

  it('isolates explicit profiles even when old data exists', () => {
    expect(resolveUserDataPath(root, '.tmp/screenshots-profile', () => true))
      .toBe(resolve('.tmp/screenshots-profile'))
  })
})
