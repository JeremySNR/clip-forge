import { copyFile, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { app } from 'electron'
import type { CustomFont } from '@shared/types'
import { fontsDir } from './pipeline/captions'

/**
 * User-uploaded caption fonts. Files live in userData/fonts; the renderer
 * loads them via media:// @font-face and libass picks them up through a
 * merged fonts directory at render time. Fonts are matched by the family
 * name embedded in the file, so we parse the sfnt `name` table instead of
 * trusting file names.
 */

const FONT_EXTENSIONS = new Set(['.ttf', '.otf'])

export function userFontsDir(): string {
  return join(app.getPath('userData'), 'fonts')
}

/**
 * Parse the font family from a TTF/OTF buffer (sfnt `name` table). Prefers
 * the typographic family (nameID 16) over the legacy family (nameID 1), and
 * Windows/Unicode records over Macintosh ones — the same order fontconfig
 * and CSS use to match families. Returns null for non-sfnt data.
 */
export function parseFontFamily(buf: Buffer): string | null {
  try {
    if (buf.length < 12) return null
    const version = buf.readUInt32BE(0)
    // 0x00010000 = TrueType, 'OTTO' = CFF OpenType, 'true' = legacy Apple.
    if (version !== 0x00010000 && version !== 0x4f54544f && version !== 0x74727565) return null
    const numTables = buf.readUInt16BE(4)
    let nameTable = -1
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16
      if (buf.toString('latin1', rec, rec + 4) === 'name') {
        nameTable = buf.readUInt32BE(rec + 8)
        break
      }
    }
    if (nameTable < 0 || nameTable + 6 > buf.length) return null

    const count = buf.readUInt16BE(nameTable + 2)
    const stringsStart = nameTable + buf.readUInt16BE(nameTable + 4)
    const candidates = new Map<number, string>()
    for (let i = 0; i < count; i++) {
      const rec = nameTable + 6 + i * 12
      const platformId = buf.readUInt16BE(rec)
      const nameId = buf.readUInt16BE(rec + 6)
      if (nameId !== 1 && nameId !== 16) continue
      const length = buf.readUInt16BE(rec + 8)
      const offset = stringsStart + buf.readUInt16BE(rec + 10)
      if (offset + length > buf.length) continue
      // Windows (3) and Unicode (0) strings are UTF-16BE; Macintosh (1) is single-byte.
      const value =
        platformId === 1
          ? buf.toString('latin1', offset, offset + length)
          : Buffer.from(buf.subarray(offset, offset + length)).swap16().toString('utf16le')
      const clean = value.trim()
      if (!clean) continue
      // Typographic family wins; among equals, later (Windows) records win.
      const priority = nameId === 16 ? 2 : platformId === 1 ? 0 : 1
      const existing = candidates.get(priority)
      if (!existing || platformId !== 1) candidates.set(priority, clean)
    }
    return candidates.get(2) ?? candidates.get(1) ?? candidates.get(0) ?? null
  } catch {
    return null
  }
}

async function fontFromFile(path: string): Promise<CustomFont | null> {
  try {
    const family = parseFontFamily(await readFile(path))
    if (!family) return null
    return { family, fileName: basename(path), path }
  } catch {
    return null
  }
}

export async function listCustomFonts(): Promise<CustomFont[]> {
  const dir = userFontsDir()
  await mkdir(dir, { recursive: true })
  const entries = await readdir(dir, { withFileTypes: true })
  const fonts: CustomFont[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !FONT_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue
    const font = await fontFromFile(join(dir, entry.name))
    if (font) fonts.push(font)
  }
  fonts.sort((a, b) => a.family.localeCompare(b.family))
  return fonts
}

/** Copy picked font files into userData/fonts; skips unparsable files. */
export async function addCustomFonts(paths: string[]): Promise<CustomFont[]> {
  const dir = userFontsDir()
  await mkdir(dir, { recursive: true })
  for (const path of paths) {
    if (!FONT_EXTENSIONS.has(extname(path).toLowerCase())) continue
    const font = await fontFromFile(path)
    if (!font) continue
    // userData paths are implicitly allowed by the media:// allowlist.
    await copyFile(path, join(dir, basename(path)))
  }
  return listCustomFonts()
}

export async function removeCustomFont(fileName: string): Promise<CustomFont[]> {
  // basename() forecloses path traversal from a compromised renderer.
  await rm(join(userFontsDir(), basename(fileName)), { force: true })
  return listCustomFonts()
}

/**
 * libass takes a single fontsdir, so exports use a merged directory holding
 * the bundled fonts plus every user font, synced on demand. Files are only
 * copied when missing or changed; stale leftovers are harmless because ASS
 * matches by family name.
 */
export async function renderFontsDir(): Promise<string> {
  const merged = join(app.getPath('userData'), 'render-fonts')
  await mkdir(merged, { recursive: true })
  const sources = [fontsDir(), userFontsDir()]
  for (const src of sources) {
    let entries: string[]
    try {
      entries = await readdir(src)
    } catch {
      continue
    }
    for (const name of entries) {
      if (!FONT_EXTENSIONS.has(extname(name).toLowerCase())) continue
      const from = join(src, name)
      const to = join(merged, name)
      try {
        const [a, b] = await Promise.all([stat(from), stat(to).catch(() => null)])
        if (!b || a.size !== b.size || a.mtimeMs > b.mtimeMs) await copyFile(from, to)
      } catch {
        /* unreadable font: skip */
      }
    }
  }
  return merged
}
