import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Sparkles, X } from 'lucide-react'
import changelog from '../../../../CHANGELOG.md?raw'
import { changelogSection, parseNotes, type NotesBlock } from '@shared/releaseNotes'
import { useStore } from '../store'

/** This build's notes, from the CHANGELOG bundled at build time. */
export function bundledNotes(version: string): NotesBlock[] {
  return userNotes(parseNotes(changelogSection(changelog, version)))
}

/** Validation write-ups are for contributors, not the in-app notes. */
export function userNotes(blocks: NotesBlock[]): NotesBlock[] {
  return blocks.filter((block) => !/^validation\b/i.test(block.heading ?? ''))
}

/** Grouped release notes; also used for an available update's notes. */
export function NotesList({ blocks, compact = false }: { blocks: NotesBlock[]; compact?: boolean }): React.JSX.Element {
  return (
    <div className={compact ? 'space-y-2' : 'space-y-4'}>
      {blocks.map((block, i) => (
        <section key={i}>
          {block.heading && (
            <h3 className={`font-semibold uppercase tracking-wide text-zinc-400 ${compact ? 'text-[10px]' : 'text-[11px]'}`}>
              {block.heading}
            </h3>
          )}
          <ul className={`mt-1.5 list-disc space-y-1 pl-4 ${compact ? 'text-[11px]' : 'text-xs'} leading-relaxed text-zinc-300`}>
            {block.items.map((item, j) => (
              <li key={j}>{item.replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1')}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

export function WhatsNewDialog({ version, onClose }: { version: string; onClose: () => void }): React.JSX.Element {
  const blocks = bundledNotes(version)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  // Portalled: opened from Settings, a transformed/clipping ancestor would
  // otherwise confine the full-window overlay to the settings panel.
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-label={`What's new in Cutawan ${version}`} data-testid="whats-new"
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl shadow-black/70"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Sparkles size={18} className="text-accent-400" />
            What&apos;s new in v{version}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" data-testid="whats-new-close" className="rounded-lg p-1 text-zinc-500 hover:bg-surface-700 hover:text-zinc-200">
            <X size={16} />
          </button>
        </div>
        <div className="mt-4">
          {blocks.length ? <NotesList blocks={blocks} /> : <p className="text-xs text-zinc-500">No release notes for this version.</p>}
        </div>
      </div>
    </div>,
    document.body
  )
}

const SEEN_KEY = 'cutawan:notes-seen-version'

/**
 * Shows this version's notes once after an update. A fresh install records
 * the version silently; someone with existing projects (updating from a
 * version before this dialog existed) sees the notes.
 */
export default function WhatsNewAfterUpdate(): React.JSX.Element | null {
  const version = useStore((s) => s.settings?.setupComplete ? s.settings.appVersion : null)
  const hasProjects = useStore((s) => s.projects.length > 0)
  const [dismissed, setDismissed] = useState<string | null>(null)
  // Read every render (cheap): a fresh install's silent write below must be
  // seen before a first project would otherwise make this look like an update.
  let seen: string | null
  try { seen = localStorage.getItem(SEEN_KEY) } catch { seen = version }
  const pending = Boolean(version && seen !== version && (seen || hasProjects) && bundledNotes(version).length)
  // A fresh install (or a version without notes) is recorded silently.
  useEffect(() => {
    if (!version || pending || seen === version) return
    try { localStorage.setItem(SEEN_KEY, version) } catch { /* storage unavailable */ }
  }, [version, pending, seen])
  if (!version || !pending || dismissed === version) return null
  return <WhatsNewDialog version={version} onClose={() => {
    try { localStorage.setItem(SEEN_KEY, version) } catch { /* storage unavailable */ }
    setDismissed(version)
  }} />
}
