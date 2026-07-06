import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isNetscapeCookiesFile } from '../src/main/cookies'
import {
  cookieArgs,
  cookieCopyErrorHint,
  isAuthError,
  isCookieCopyError,
  pluginArgs
} from '../src/main/pipeline/ytdlp'

describe('isNetscapeCookiesFile', () => {
  it('accepts standard Netscape headers', () => {
    expect(
      isNetscapeCookiesFile('# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tFALSE\t0\tid\tabc')
    ).toBe(true)
  })

  it('accepts tab-separated cookie rows without a header', () => {
    expect(isNetscapeCookiesFile('.vimeo.com\tTRUE\t/\tTRUE\t0\tsession\tsecret')).toBe(true)
  })

  it('rejects JSON and empty files', () => {
    expect(isNetscapeCookiesFile('{"cookies":[]}')).toBe(false)
    expect(isNetscapeCookiesFile('')).toBe(false)
  })
})

describe('ytdlp cookie helpers', () => {
  it('prefers cookies file over browser extraction', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clipforge-cookies-'))
    const file = join(dir, 'cookies.txt')
    writeFileSync(file, '# Netscape HTTP Cookie File\n')
    expect(cookieArgs({ cookiesFile: file, cookiesFromBrowser: 'chrome' })).toEqual([
      '--cookies',
      file
    ])
  })

  it('falls back to browser cookies when no file is set', () => {
    expect(cookieArgs({ cookiesFromBrowser: 'firefox' })).toEqual([
      '--cookies-from-browser',
      'firefox'
    ])
  })

  it('loads the unlock plugin when borrowing browser cookies', () => {
    const args = pluginArgs({ cookiesFromBrowser: 'chrome' })
    expect(args[0]).toBe('--plugin-dirs')
    expect(args[1]).toContain('yt-dlp-plugins')
  })

  it('detects cookie copy failures and auth errors', () => {
    expect(isCookieCopyError('Could not copy Chrome cookie database')).toBe(true)
    expect(isAuthError('HTTP Error 403: Forbidden')).toBe(true)
  })

  it('suggests cookies file import for Chromium lock errors', () => {
    const hint = cookieCopyErrorHint('chrome', false)
    expect(hint).toContain('cookies.txt')
    expect(hint).toContain('Firefox')
  })
})
