import { useEffect } from 'react'
import { useStore, type Screen } from './store'
import HomeScreen from './components/HomeScreen'
import ProcessingScreen from './components/ProcessingScreen'
import ClipsScreen from './components/ClipsScreen'
import EditorScreen from './components/EditorScreen'
import SettingsModal from './components/SettingsModal'
import TopBar from './components/TopBar'
import SetupWizard from './components/SetupWizard'
import WhatsNewAfterUpdate from './components/WhatsNew'
import { startUpdateChecks } from '@shared/updateSchedule'

function ScreenView({ screen }: { screen: Screen }): React.JSX.Element {
  switch (screen) {
    case 'home':
      return <HomeScreen />
    case 'processing':
      return <ProcessingScreen />
    case 'clips':
      return <ClipsScreen />
    case 'editor':
      return <EditorScreen />
    default: {
      const exhaustive: never = screen
      return exhaustive
    }
  }
}

export default function App(): React.JSX.Element {
  const screen = useStore((s) => s.screen)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const settings = useStore((s) => s.settings)
  const init = useStore((s) => s.init)

  useEffect(() => {
    void init()
    // macOS renders with native vibrancy behind a translucent shell; the
    // class switches the surface palette to translucent variants (index.css).
    if (window.cutawan.platform === 'darwin') document.body.classList.add('mac-glass')

    // Dropping a file anywhere outside a designated drop zone would otherwise
    // make Chromium navigate the window to that file and blow away the app.
    const preventNav = (e: DragEvent): void => e.preventDefault()
    window.addEventListener('dragover', preventNav)
    window.addEventListener('drop', preventNav)
    return () => {
      window.removeEventListener('dragover', preventNav)
      window.removeEventListener('drop', preventNav)
    }
  }, [init])

  useEffect(() => {
    let alive = true
    let receivedEvent = false
    const unsubscribe = window.cutawan.onUpdateDownloadState((state) => {
      receivedEvent = true
      useStore.setState({ updateDownload: state })
    })
    void window.cutawan.getUpdateDownloadState().then((state) => {
      if (alive && !receivedEvent) useStore.setState({ updateDownload: state })
    }).catch(() => undefined)
    const stop = startUpdateChecks(() => useStore.getState().checkForUpdates(true), window)
    return () => { alive = false; stop(); unsubscribe() }
  }, [])

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="min-h-0 flex-1">
        <ScreenView screen={screen} />
      </main>
      {settingsOpen && <SettingsModal />}
      {settings && !settings.setupComplete && <SetupWizard />}
      <WhatsNewAfterUpdate />
    </div>
  )
}
