import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseFontFamily } from '../src/main/fonts'

const fontsDir = join(__dirname, '..', 'resources', 'fonts')

describe('parseFontFamily', () => {
  it('reads the family name from bundled TTFs', () => {
    expect(parseFontFamily(readFileSync(join(fontsDir, 'Anton-Regular.ttf')))).toBe('Anton')
    // Poppins-Bold's typographic family (nameID 16) is "Poppins", not "Poppins Bold".
    expect(parseFontFamily(readFileSync(join(fontsDir, 'Poppins-Bold.ttf')))).toBe('Poppins')
  })

  it('rejects non-font data', () => {
    expect(parseFontFamily(Buffer.from('not a font at all'))).toBeNull()
    expect(parseFontFamily(Buffer.alloc(4))).toBeNull()
    expect(parseFontFamily(Buffer.alloc(0))).toBeNull()
  })

  it('survives a truncated font without throwing', () => {
    const full = readFileSync(join(fontsDir, 'Anton-Regular.ttf'))
    expect(() => parseFontFamily(full.subarray(0, 64))).not.toThrow()
  })
})
