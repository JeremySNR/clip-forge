import { describe, expect, it } from 'vitest'
import { compareVersions, evaluateUpdate } from '../src/main/updates'

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

  it('carries the auto-update capability flag through', () => {
    const release = { tag_name: 'v0.2.0' }
    expect(evaluateUpdate('0.1.0', release, true).autoUpdateSupported).toBe(true)
    expect(evaluateUpdate('0.1.0', release, false).autoUpdateSupported).toBe(false)
    // Source checkouts default to no self-update.
    expect(evaluateUpdate('0.1.0', release).autoUpdateSupported).toBe(false)
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
