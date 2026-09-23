/**
 * Pull-request gate: a change people will notice needs release notes.
 *
 * If the diff against the base branch touches the app (src/, resources/ or
 * package.json) it must also add notes under `## [Unreleased]` in
 * CHANGELOG.md; the release workflow later publishes that section, and the
 * app shows it as "What's new". Internal-only changes (tests, CI, docs,
 * refactors with no visible effect) can carry the `no release notes` label.
 *
 * Usage: BASE_REF=origin/main PR_LABELS='["..."]' node scripts/check-release-notes.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const baseRef = process.env.BASE_REF || 'origin/main'
// Accept a JSON list, a single JSON string or a bare name, whatever the
// workflow expression renders to.
const parseLabels = (raw) => {
  if (!raw) return []
  try {
    const value = JSON.parse(raw)
    return (Array.isArray(value) ? value : [value]).map((l) => String(l).toLowerCase())
  } catch {
    return [raw.toLowerCase()]
  }
}
const labels = parseLabels(process.env.PR_LABELS)
if (labels.includes('no release notes')) {
  console.log('Skipped: labelled "no release notes".')
  process.exit(0)
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' })
const changed = git('diff', '--name-only', `${baseRef}...HEAD`).split('\n').filter(Boolean)
const userFacing = changed.filter((f) => /^(src|resources)\//.test(f) || f === 'package.json')
if (!userFacing.length) {
  console.log('No app changes; release notes not required.')
  process.exit(0)
}

// Bullets under [Unreleased] and under every version section. A release PR
// renames [Unreleased] to the new version, so a new or changed section of
// either kind counts as release notes.
const sections = (text) => {
  const out = new Map()
  let name = null
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^##\s+\[?([^\]\s]+)\]?/)
    if (heading) { name = heading[1].toLowerCase(); out.set(name, []); continue }
    if (name && /^\s*[-*]\s+\S/.test(line)) out.get(name).push(line.trim())
  }
  return out
}
let baseSections = new Map()
try { baseSections = sections(git('show', `${baseRef}:CHANGELOG.md`)) } catch { /* new file */ }
const head = sections(readFileSync('CHANGELOG.md', 'utf8'))
const added = [...head].filter(([name, bullets]) =>
  (name === 'unreleased' || /^[0-9]+\.[0-9]+\.[0-9]+$/.test(name)) && bullets.length &&
  bullets.join('\n') !== (baseSections.get(name) ?? []).join('\n'))

if (!added.length) {
  console.error([
    'This pull request changes the app but adds no release notes.',
    '',
    'Add a line under "## [Unreleased]" in CHANGELOG.md (### Added, ### Improved or',
    '### Fixed) saying what changed for people using Cutawan. If nothing visible',
    'changed, add the "no release notes" label.',
    '',
    `App files changed: ${userFacing.slice(0, 8).join(', ')}${userFacing.length > 8 ? ', …' : ''}`
  ].join('\n'))
  process.exit(1)
}
console.log(`Release notes present: ${added.map(([name]) => `[${name}]`).join(', ')}.`)
