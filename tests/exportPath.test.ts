import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { sanitizeFileName, uniqueOutputPath } from '../src/main/exportPath'

describe('sanitizeFileName', () => {
  it('strips characters that are invalid on any OS', () => {
    expect(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij')
  })

  it('collapses whitespace and trims', () => {
    expect(sanitizeFileName('  hello   world  ')).toBe('hello world')
  })

  it('falls back to "clip" when nothing survives', () => {
    expect(sanitizeFileName('???')).toBe('clip')
  })

  it('caps length at 80 characters', () => {
    expect(sanitizeFileName('x'.repeat(200)).length).toBe(80)
  })
})

describe('uniqueOutputPath', () => {
  it('returns the plain name when free', () => {
    expect(uniqueOutputPath('/out', 'My Clip', () => false)).toBe(join('/out', 'My Clip.mp4'))
  })

  it('appends (2), (3)… until a free name is found', () => {
    const taken = new Set([join('/out', 'My Clip.mp4'), join('/out', 'My Clip (2).mp4')])
    expect(uniqueOutputPath('/out', 'My Clip', (p) => taken.has(p))).toBe(
      join('/out', 'My Clip (3).mp4')
    )
  })
})
