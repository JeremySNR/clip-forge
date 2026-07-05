import { useEffect } from 'react'
import { useStore, type Screen } from './store'
import HomeScreen from './components/HomeScreen'
import ProcessingScreen from './components/ProcessingScreen'
import ClipsScreen from './components/ClipsScreen'
import EditorScreen from './components/EditorScreen'
import SettingsModal from './components/SettingsModal'
import TopBar from './components/TopBar'

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
  const init = useStore((s) => s.init)

  useEffect(() => {
    void init()
    // macOS renders with native vibrancy behind a translucent shell; the
    // class switches the surface palette to translucent variants (index.css).
    if (window.clipforge.platform === 'darwin') document.body.classList.add('mac-glass')
  }, [init])

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="min-h-0 flex-1">
        <ScreenView screen={screen} />
      </main>
      {settingsOpen && <SettingsModal />}
    </div>
  )
}
