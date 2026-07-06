import { describe, expect, it } from 'vitest'
import { deriveWorkvivoApiBase, extractPermalink } from '../src/main/pipeline/workvivo'

describe('deriveWorkvivoApiBase', () => {
  it('appends /api/v1 to a full org URL', () => {
    expect(deriveWorkvivoApiBase('https://acme.workvivo.com')).toBe('https://acme.workvivo.com/api/v1')
  })

  it('handles the .us region', () => {
    expect(deriveWorkvivoApiBase('https://acme.workvivo.us')).toBe('https://acme.workvivo.us/api/v1')
  })

  it('adds a scheme to a bare host', () => {
    expect(deriveWorkvivoApiBase('acme.workvivo.com')).toBe('https://acme.workvivo.com/api/v1')
  })

  it('ignores any path already on the URL and uses the origin', () => {
    expect(deriveWorkvivoApiBase('https://acme.workvivo.com/api/v1/')).toBe(
      'https://acme.workvivo.com/api/v1'
    )
    expect(deriveWorkvivoApiBase('https://acme.workvivo.com/dashboard')).toBe(
      'https://acme.workvivo.com/api/v1'
    )
  })

  it('returns null for empty or unusable values', () => {
    expect(deriveWorkvivoApiBase('')).toBeNull()
    expect(deriveWorkvivoApiBase('   ')).toBeNull()
    expect(deriveWorkvivoApiBase(undefined)).toBeNull()
    expect(deriveWorkvivoApiBase('not a url')).toBeNull()
    // A single-label host is not a real WorkVivo tenant.
    expect(deriveWorkvivoApiBase('localhost')).toBeNull()
  })
})

describe('extractPermalink', () => {
  it('reads a top-level permalink or url', () => {
    expect(extractPermalink({ permalink: 'https://x/comments/1' })).toBe('https://x/comments/1')
    expect(extractPermalink({ url: 'https://x/p/2' })).toBe('https://x/p/2')
  })

  it('reads a nested data.permalink', () => {
    expect(extractPermalink({ data: { permalink: 'https://x/comments/3' } })).toBe(
      'https://x/comments/3'
    )
  })

  it('returns null when no link is present', () => {
    expect(extractPermalink({})).toBeNull()
    expect(extractPermalink(null)).toBeNull()
    expect(extractPermalink('nope')).toBeNull()
    expect(extractPermalink({ data: {} })).toBeNull()
  })
})
