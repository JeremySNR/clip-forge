/**
 * Release notes come from CHANGELOG.md: the release workflow publishes a
 * version's section as its GitHub release notes, and the app shows the same
 * section as "What's new" after an update.
 */

const headingVersion = (line: string): string | undefined =>
  line.match(/^##\s+\[?([0-9]+\.[0-9]+\.[0-9]+)\]?/)?.[1]

/** The body of `## [version]` in a changelog, trimmed; empty when absent. */
export function changelogSection(changelog: string, version: string): string {
  const lines = changelog.split(/\r?\n/)
  const start = lines.findIndex((line) => headingVersion(line) === version)
  if (start === -1) return ''
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => /^##\s+/.test(line))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim()
}

export interface NotesBlock { heading: string | null; items: string[] }

/**
 * Split a section into `### Heading` groups of bullet items, joining wrapped
 * bullet lines. Only the plain structure the changelog uses; no general
 * Markdown.
 */
export function parseNotes(section: string): NotesBlock[] {
  const blocks: NotesBlock[] = []
  let current: NotesBlock | null = null
  for (const raw of section.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const heading = line.match(/^###\s+(.*)$/)
    if (heading) { current = { heading: heading[1], items: [] }; blocks.push(current); continue }
    if (!current) { current = { heading: null, items: [] }; blocks.push(current) }
    if (/^[-*]\s+/.test(line)) current.items.push(line.replace(/^[-*]\s+/, ''))
    else if (current.items.length) current.items[current.items.length - 1] += ` ${line}`
    else current.items.push(line)
  }
  return blocks.filter((b) => b.items.length)
}
