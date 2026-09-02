import { app } from 'electron'
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises'
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const COOKIES_FILE_NAME = 'import-cookies.txt'

function userDataDir(): string {
  return app?.getPath?.('userData') ?? join(process.cwd(), '.tmp', 'userData')
}

/**
 * Where imported cookie files live.
 *
 * NOT `userData/cookies`: Chromium keeps its own cookie database as a file
 * called `Cookies` in the profile root, and Windows paths are
 * case-insensitive — so a directory of ours by that name collides with it. The
 * network service then fails to migrate its data on every launch ("Failed to
 * delete file …\Cookies: The directory is not empty"), and with no network
 * service the renderer cannot load at all: in dev, where it comes from the
 * Vite server over HTTP, the window just sits there white and unresponsive.
 */
export function cookiesDir(): string {
  return join(userDataDir(), 'import-cookies')
}

/** The pre-fix location, kept only so existing installs can be migrated. */
function legacyCookiesDir(): string {
  return join(userDataDir(), 'cookies')
}

/**
 * Move an imported cookies file out of the colliding `cookies` directory and
 * delete the directory, so the profile stops breaking Chromium's network
 * service. Safe to call repeatedly; does nothing once migrated.
 */
export function migrateLegacyCookiesDir(): void {
  const legacy = legacyCookiesDir()
  if (!existsSync(legacy)) return
  try {
    const legacyFile = join(legacy, COOKIES_FILE_NAME)
    if (existsSync(legacyFile)) {
      mkdirSync(cookiesDir(), { recursive: true })
      // Only keep it if the new location is empty: a file imported since the
      // fix is the newer one.
      const dest = join(cookiesDir(), COOKIES_FILE_NAME)
      if (!existsSync(dest)) copyFileSync(legacyFile, dest)
    }
    rmSync(legacy, { recursive: true, force: true })
  } catch (err) {
    // Never block startup on this; the worst case is the old warning returning.
    console.error('Could not migrate the legacy cookies directory:', err)
  }
}

/** Absolute path to the stored Netscape cookies file, or null when unset. */
export function getImportCookiesPath(): string | null {
  const path = join(cookiesDir(), COOKIES_FILE_NAME)
  return existsSync(path) ? path : null
}

/** True when the file looks like a Netscape-format cookies export. */
export function isNetscapeCookiesFile(content: string): boolean {
  const trimmed = content.trimStart()
  if (!trimmed) return false
  const firstLine = trimmed.split(/\r?\n/, 1)[0] ?? ''
  return (
    firstLine.includes('Netscape') ||
    firstLine.includes('HTTP Cookie File') ||
    // Some exporters omit the header but keep tab-separated fields.
    (/^[^\t]+\t(TRUE|FALSE)\t[^\t]+\t(TRUE|FALSE)\t\d+\t[^\t]+\t[^\t]+/i.test(trimmed) &&
      !firstLine.startsWith('{'))
  )
}

export async function installImportCookiesFile(sourcePath: string): Promise<string> {
  const raw = await readFile(sourcePath, 'utf8')
  if (!isNetscapeCookiesFile(raw)) {
    throw new Error(
      'That file does not look like a Netscape cookies export. Use the "Get cookies.txt LOCALLY" browser extension while signed in to the site, then import the .txt file it saves.'
    )
  }
  await mkdir(cookiesDir(), { recursive: true })
  const dest = join(cookiesDir(), COOKIES_FILE_NAME)
  await copyFile(sourcePath, dest)
  return dest
}

export async function clearImportCookiesFile(): Promise<void> {
  const path = join(cookiesDir(), COOKIES_FILE_NAME)
  if (existsSync(path)) await rm(path, { force: true })
}
