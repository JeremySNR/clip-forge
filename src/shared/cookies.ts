import type { BrowserCookieSource } from './types'

export const CHROMIUM_BROWSERS: ReadonlySet<BrowserCookieSource> = new Set([
  'chrome',
  'edge',
  'brave',
  'opera',
  'vivaldi'
])

export function isChromiumBrowser(browser: BrowserCookieSource): boolean {
  return CHROMIUM_BROWSERS.has(browser)
}
