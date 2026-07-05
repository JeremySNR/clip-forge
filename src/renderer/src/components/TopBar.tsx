import { Clapperboard, Settings, ChevronLeft, ArrowUpCircle } from 'lucide-react'
import { useStore } from '../store'

export default function TopBar(): React.JSX.Element {
  const screen = useStore((s) => s.screen)
  const project = useStore((s) => s.project)
  const goHome = useStore((s) => s.goHome)
  const closeEditor = useStore((s) => s.closeEditor)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const settings = useStore((s) => s.settings)
  const updateCheck = useStore((s) => s.updateCheck)

  const showBack = screen === 'clips' || screen === 'editor'

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.06] bg-surface-950/70 px-4 backdrop-blur-xl">
      {showBack ? (
        <button
          onClick={() => (screen === 'editor' ? closeEditor() : goHome())}
          className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-zinc-400 transition hover:bg-surface-800 hover:text-zinc-100"
        >
          <ChevronLeft size={16} />
          {screen === 'editor' ? 'All clips' : 'Home'}
        </button>
      ) : (
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] shadow-inner shadow-white/5">
            <Clapperboard size={17} className="text-zinc-100" />
          </div>
          <span className="text-[15px] font-semibold tracking-tight">ClipForge</span>
          <span className="rounded-full border border-surface-600 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
            Open source
          </span>
        </div>
      )}

      {showBack && project && (
        <div className="min-w-0 flex-1 truncate text-center text-sm font-medium text-zinc-300">
          {project.name}
        </div>
      )}
      {!showBack && <div className="flex-1" />}

      <div className="flex items-center gap-2">
        {updateCheck?.updateAvailable && updateCheck.releaseUrl && (
          <a
            href={updateCheck.releaseUrl}
            target="_blank"
            rel="noreferrer"
            title={`ClipForge v${updateCheck.latestVersion} is available — open the release page`}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-400 transition hover:bg-emerald-500/25"
          >
            <ArrowUpCircle size={14} />
            Update available
          </a>
        )}
        {settings && !settings.hasApiKey && (
          <button
            onClick={() => setSettingsOpen(true)}
            className="rounded-lg bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-400 transition hover:bg-amber-500/25"
          >
            Add OpenAI API key to get started
          </button>
        )}
        <button
          onClick={() => setSettingsOpen(true)}
          data-testid="settings-button"
          className="rounded-lg p-2 text-zinc-400 transition hover:bg-surface-800 hover:text-zinc-100"
          title="Settings"
        >
          <Settings size={18} />
        </button>
      </div>
    </header>
  )
}
