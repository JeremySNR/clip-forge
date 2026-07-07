import { describe, expect, it } from 'vitest'
import { deriveWorkvivoApiBase, extractPermalink } from '../src/main/pipeline/workvivo'

describe('deriveWorkvivoApiBase', () => {
  it('maps a .com tenant to the central api.workvivo.com host', () => {
    expect(deriveWorkvivoApiBase('https://acme.workvivo.com')).toBe('https://api.workvivo.com/v1')
  })

  it('maps a .us tenant to the api.workvivo.us region host', () => {
    expect(deriveWorkvivoApiBase('https://acme.workvivo.us')).toBe('https://api.workvivo.us/v1')
  })

  it('adds a scheme to a bare host', () => {
    expect(deriveWorkvivoApiBase('acme.workvivo.com')).toBe('https://api.workvivo.com/v1')
  })

  it('ignores any path on the URL and keys off the tenant TLD only', () => {
    expect(deriveWorkvivoApiBase('https://acme.workvivo.us/dashboard')).toBe(
      'https://api.workvivo.us/v1'
    )
    expect(deriveWorkvivoApiBase('https://acme.workvivo.com/api/v1/')).toBe(
      'https://api.workvivo.com/v1'
    )
  })

  it('is idempotent when given the API host itself', () => {
    expect(deriveWorkvivoApiBase('https://api.workvivo.com/v1')).toBe('https://api.workvivo.com/v1')
  })

  it('defaults a non-WorkVivo host to the .com region', () => {
    expect(deriveWorkvivoApiBase('https://intranet.acme.co.uk')).toBe('https://api.workvivo.com/v1')
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
