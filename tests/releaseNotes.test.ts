import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { changelogSection, parseNotes } from '@shared/releaseNotes'

const sample = `# Changelog

## [Unreleased]

### Added

- New thing

## [1.2.0] - 2026-09-01

### Improved

- Faster exports that
  wrap onto a second line.
- Steadier camera.

### Fixed

- A bug.

## [1.1.0] - 2026-08-01

- Old.
`

describe('release notes', () => {
  it('extracts one version and groups its bullets under headings', () => {
    const section = changelogSection(sample, '1.2.0')
    expect(section).not.toContain('New thing')
    expect(section).not.toContain('Old.')
    expect(parseNotes(section)).toEqual([
      { heading: 'Improved', items: ['Faster exports that wrap onto a second line.', 'Steadier camera.'] },
      { heading: 'Fixed', items: ['A bug.'] }
    ])
  })

  it('returns nothing for a version without notes', () => {
    expect(changelogSection(sample, '9.9.9')).toBe('')
    expect(parseNotes('')).toEqual([])
  })

  it('has notes for the current package version, as releases require', () => {
    const version = JSON.parse(readFileSync('package.json', 'utf8')).version
    expect(parseNotes(changelogSection(readFileSync('CHANGELOG.md', 'utf8'), version)).length).toBeGreaterThan(0)
  })
})
