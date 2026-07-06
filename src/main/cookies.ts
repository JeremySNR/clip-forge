import { app } from 'electron'
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const COOKIES_FILE_NAME = 'import-cookies.txt'

export function cookiesDir(): string {
  const base = app?.getPath?.('userData') ?? join(process.cwd(), '.tmp', 'userData')
  return join(base, 'cookies')
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
