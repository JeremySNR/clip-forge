import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isMediaPathAllowedIn } from '../src/main/mediaAccess'

const userData = join(process.cwd(), 'fake-user-data')
const none: ReadonlySet<string> = new Set()

describe('isMediaPathAllowedIn', () => {
  it('allows project media (thumbnails, B-roll, downloaded sources)', () => {
    expect(
      isMediaPathAllowedIn(userData, none, join(userData, 'projects', 'p1', 'thumbs', 'c1.jpg'))
    ).toBe(true)
    expect(
      isMediaPathAllowedIn(userData, none, join(userData, 'projects', 'p1', 'source.mp4'))
    ).toBe(true)
  })

  it('allows custom fonts, branding and timeline cache', () => {
    expect(isMediaPathAllowedIn(userData, none, join(userData, 'fonts', 'Anton.ttf'))).toBe(true)
    expect(isMediaPathAllowedIn(userData, none, join(userData, 'branding', 'logo.png'))).toBe(true)
    expect(
      isMediaPathAllowedIn(userData, none, join(userData, 'timeline-cache', 'k', 'f001.jpg'))
    ).toBe(true)
  })

  it('allows explicitly registered files outside userData', () => {
    const video = join(process.cwd(), 'somewhere', 'talk.mp4')
    expect(isMediaPathAllowedIn(userData, new Set([video]), video)).toBe(true)
    expect(isMediaPathAllowedIn(userData, none, video)).toBe(false)
  })

  it('denies secrets living in userData (the reason the list is explicit)', () => {
    expect(isMediaPathAllowedIn(userData, none, join(userData, 'settings.json'))).toBe(false)
    expect(
      isMediaPathAllowedIn(userData, none, join(userData, 'cookies', 'import-cookies.txt'))
    ).toBe(false)
  })

  it('denies the userData root and prefix-sibling directories', () => {
    expect(isMediaPathAllowedIn(userData, none, userData)).toBe(false)
    // "projects-evil" must not pass a naive startsWith("...projects") check.
    expect(
      isMediaPathAllowedIn(userData, none, join(userData, 'projects-evil', 'x.jpg'))
    ).toBe(false)
  })

  it('denies traversal out of an allowed directory', () => {
    expect(
      isMediaPathAllowedIn(
        userData,
        none,
        join(userData, 'projects', '..', 'settings.json')
      )
    ).toBe(false)
  })
})
