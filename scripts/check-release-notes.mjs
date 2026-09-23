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

const base = process.env.BASE_REF || 'origin/main'
const labels = JSON.parse(process.env.PR_LABELS || '[]').map((l) => String(l).toLowerCase())
if (labels.includes('no release notes')) {
  console.log('Skipped: labelled "no release notes".')
  process.exit(0)
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' })
const changed = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean)
const userFacing = changed.filter((f) => /^(src|resources)\//.test(f) || f === 'package.json')
if (!userFacing.length) {
  console.log('No app changes; release notes not required.')
  process.exit(0)
}

const unreleased = (text) => {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((l) => /^##\s+\[?unreleased\]?/i.test(l))
  if (start === -1) return ''
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => /^##\s+/.test(l))
  return (end === -1 ? rest : rest.slice(0, end)).filter((l) => /^\s*[-*]\s+\S/.test(l)).join('\n')
}
let before = ''
try { before = unreleased(git('show', `${base}:CHANGELOG.md`)) } catch { /* new file */ }
const after = unreleased(readFileSync('CHANGELOG.md', 'utf8'))

if (!after || after === before) {
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
console.log('Release notes present under [Unreleased].')
