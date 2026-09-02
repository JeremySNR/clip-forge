/**
 * Prints the CHANGELOG.md section for a given version, for use as GitHub
 * release notes.
 *
 * Plain Node ESM rather than a tsx script like the rest of `scripts/`, so the
 * release workflow can run it without an `npm ci` just to get tsx.
 *
 * Usage: node scripts/changelog-section.mjs 0.7.0
 * Exits 0 with empty output if there is no section for that version, so a
 * release with no changelog entry still publishes rather than failing.
 */
import { readFile } from 'node:fs/promises'

const version = process.argv[2]
if (!version) {
  console.error('usage: node scripts/changelog-section.mjs <version>')
  process.exit(2)
}

const text = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
const lines = text.split(/\r?\n/)

// Section headings look like `## [0.7.0] - 2026-09-02`. Match the version
// inside the brackets so the date is free to change format.
const isHeading = (line) => /^##\s+/.test(line)
const headingVersion = (line) => line.match(/^##\s+\[?([0-9]+\.[0-9]+\.[0-9]+)\]?/)?.[1]

const start = lines.findIndex((l) => headingVersion(l) === version)
if (start === -1) process.exit(0)

const rest = lines.slice(start + 1)
const end = rest.findIndex(isHeading)
const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim()

process.stdout.write(body)
