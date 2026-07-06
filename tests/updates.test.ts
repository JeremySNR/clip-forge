import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  evaluateUpdate,
  findGitRoot,
  resolveSourceRepoRoot,
  spawnStepOptions
} from '../src/main/updates'

describe('findGitRoot', () => {
  it('walks up from a nested directory to the repo root', () => {
    const root = findGitRoot(join(process.cwd(), 'out', 'main'))
    expect(root).toBe(process.cwd())
    expect(existsSync(join(root!, '.git'))).toBe(true)
  })

  it('returns null when no git directory exists above the start path', () => {
    expect(findGitRoot('/tmp')).toBeNull()
  })
})

describe('resolveSourceRepoRoot', () => {
  it('finds the clipforge checkout from the workspace cwd', () => {
    expect(resolveSourceRepoRoot()).toBe(process.cwd())
  })
})

describe('compareVersions', () => {
  it('orders dotted versions numerically', () => {
    expect(compareVersions('0.2.0', '0.1.0')).toBeGreaterThan(0)
    expect(compareVersions('0.1.0', '0.2.0')).toBeLessThan(0)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    // Numeric, not lexicographic: 0.10 > 0.9.
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0)
  })

  it('ignores the v prefix and pre-release suffixes', () => {
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('1.2.3-beta.1', '1.2.3')).toBe(0)
  })

  it('treats missing segments as zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
    expect(compareVersions('1.2.1', '1.2')).toBeGreaterThan(0)
  })
})

describe('spawnStepOptions', () => {
  it('enables shell for npm on Windows (CVE-2024-27980)', () => {
    if (process.platform !== 'win32') return
    expect(spawnStepOptions('npm', process.cwd()).shell).toBe(true)
    expect(spawnStepOptions('npm.cmd', process.cwd()).shell).toBe(true)
    expect(spawnStepOptions('git', process.cwd()).shell).toBeUndefined()
  })

  it('does not force shell on Unix', () => {
    if (process.platform === 'win32') return
    expect(spawnStepOptions('npm', process.cwd()).shell).toBeUndefined()
    expect(spawnStepOptions('git', process.cwd()).shell).toBeUndefined()
  })
})

describe('evaluateUpdate', () => {
  it('flags an update when the release is newer', () => {
    const res = evaluateUpdate('0.1.0', {
      tag_name: 'v0.2.0',
      html_url: 'https://github.com/x/y/releases/tag/v0.2.0'
    })
    expect(res.updateAvailable).toBe(true)
    expect(res.latestVersion).toBe('0.2.0')
    expect(res.releaseUrl).toBe('https://github.com/x/y/releases/tag/v0.2.0')
    expect(res.error).toBeNull()
  })

  it('reports up to date when the release matches or is older', () => {
    expect(evaluateUpdate('0.2.0', { tag_name: 'v0.2.0' }).updateAvailable).toBe(false)
    expect(evaluateUpdate('0.3.0', { tag_name: 'v0.2.0' }).updateAvailable).toBe(false)
  })

  it('handles a repo with no releases', () => {
    const res = evaluateUpdate('0.1.0', null)
    expect(res.updateAvailable).toBe(false)
    expect(res.latestVersion).toBeNull()
    expect(res.releaseUrl).toBeNull()
  })

  it('carries the update capability flags through', () => {
    const release = { tag_name: 'v0.2.0' }
    expect(evaluateUpdate('0.1.0', release, true).autoUpdateSupported).toBe(true)
    expect(evaluateUpdate('0.1.0', release, false).autoUpdateSupported).toBe(false)
    expect(evaluateUpdate('0.1.0', release, false, true).sourceUpdateSupported).toBe(true)
    // Bare defaults: no self-update paths in the pure evaluator.
    const bare = evaluateUpdate('0.1.0', release)
    expect(bare.autoUpdateSupported).toBe(false)
    expect(bare.sourceUpdateSupported).toBe(false)
  })

  it('ignores drafts and pre-releases', () => {
    expect(
      evaluateUpdate('0.1.0', { tag_name: 'v9.9.9', draft: true }).updateAvailable
    ).toBe(false)
    expect(
      evaluateUpdate('0.1.0', { tag_name: 'v9.9.9', prerelease: true }).updateAvailable
    ).toBe(false)
  })
})
