/**
 * Prints the CHANGELOG.md section for a given version, for use as GitHub
 * release notes.
 *
 * Plain Node ESM rather than a tsx script like the rest of `scripts/`, so the
 * release workflow can run it without an `npm ci` just to get tsx. Mirrors
 * `changelogSection` in src/shared/releaseNotes.ts.
 *
 * Usage: node scripts/changelog-section.mjs 0.7.0 [--require]
 * With --require (the release workflow), a missing or empty section fails:
 * every release must say what changed. Without it, prints nothing.
 */
import { readFile } from 'node:fs/promises'

const version = process.argv[2]
const required = process.argv.includes('--require')
if (!version || version.startsWith('--')) {
  console.error('usage: node scripts/changelog-section.mjs <version> [--require]')
  process.exit(2)
}

const text = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
const lines = text.split(/\r?\n/)

// Section headings look like `## [0.7.0] - 2026-09-02`. Match the version
// inside the brackets so the date is free to change format.
const isHeading = (line) => /^##\s+/.test(line)
const headingVersion = (line) => line.match(/^##\s+\[?([0-9]+\.[0-9]+\.[0-9]+)\]?/)?.[1]

const start = lines.findIndex((l) => headingVersion(l) === version)
const rest = start === -1 ? [] : lines.slice(start + 1)
const end = rest.findIndex(isHeading)
const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim()

if (!body && required) {
  console.error(`CHANGELOG.md has no notes for ${version}. Rename "## [Unreleased]" to "## [${version}] - <date>" before releasing.`)
  process.exit(1)
}
process.stdout.write(body)
