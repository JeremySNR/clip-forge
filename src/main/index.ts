import { app, BrowserWindow, nativeTheme, protocol, screen, shell } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { registerIpcHandlers } from './ipc'
import { isMediaPathAllowed, serveMediaFile } from './mediaAccess'
import { initialWindowSize, MIN_WINDOW } from './windowSize'

function appIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(app.getAppPath(), 'build/icon.png')
}

async function runSmokeCapture(win: BrowserWindow, dir: string): Promise<void> {
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  const shot = async (name: string): Promise<void> => {
    const image = await win.webContents.capturePage()
    await writeFile(join(dir, `${name}.png`), image.toPNG())
  }
  const click = (selector: string): Promise<unknown> =>
    win.webContents.executeJavaScript(
      `document.querySelector(${JSON.stringify(selector)})?.click()`
    )
  await sleep(2500)
  await shot('home')
  await click('[data-testid="project-card"]')
  await sleep(1200)
  await shot('clips')
  await click('[data-testid="clip-thumb"]')
  await sleep(1500)
  await shot('editor')
  await click('[data-testid="settings-button"]')
  await sleep(1200)
  await shot('settings')
  app.quit()
}

// Serves local media (source videos, thumbnails) to the sandboxed renderer.
// URL shape: media://file/<encodeURIComponent(absolutePath)>
// `standard` matters: Chromium's media loader aborts its second range request
// on non-standard schemes, which broke <video> playback of files over ~2 MB.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

function applyAppIcon(): void {
  const icon = appIconPath()
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(icon)
  }
}

function createWindow(): void {
  // A floating window with margin around it, never edge-to-edge (and never
  // larger than the work area on small laptop displays).
  const { width, height } = initialWindowSize(screen.getPrimaryDisplay().workAreaSize)
  const isMac = process.platform === 'darwin'
  const win = new BrowserWindow({
    width,
    height,
    minWidth: MIN_WINDOW.width,
    minHeight: MIN_WINDOW.height,
    center: true,
    show: false,
    autoHideMenuBar: true,
    title: 'ClipForge',
    icon: appIconPath(),
    // macOS gets the native frosted-glass treatment: system vibrancy showing
    // through a translucent shell (the renderer lightens its surfaces via the
    // `mac-glass` body class), an inset title bar and our top bar as the drag
    // region. Other platforms keep the solid dark background.
    ...(isMac
      ? {
          backgroundColor: '#00000000',
          vibrancy: 'under-window' as const,
          visualEffectState: 'active' as const,
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 18, y: 20 }
        }
      : { backgroundColor: '#09090b' }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // Headless smoke test hook: CLIPFORGE_SMOKE=/dir walks the main screens,
  // capturing a screenshot of each, then quits (see scripts/smoke-test.sh).
  const smokeDir = process.env.CLIPFORGE_SMOKE
  if (smokeDir) {
    win.webContents.on('did-finish-load', () => {
      void runSmokeCapture(win, smokeDir)
    })
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // The UI is a dark, near-monochrome design and (on macOS) leans on native
  // vibrancy showing through translucent surfaces. Under the system's light
  // appearance that blur turns the window a washed-out grey, so we pin the
  // whole app to dark regardless of the OS setting.
  nativeTheme.themeSource = 'dark'

  protocol.handle('media', (request) => {
    const url = new URL(request.url)
    const filePath = decodeURIComponent(url.pathname.replace(/^\//, ''))
    // Only serve files the app registered (project media), never arbitrary disk paths.
    if (!isMediaPathAllowed(filePath)) {
      return new Response('Forbidden', { status: 403 })
    }
    return serveMediaFile(filePath, request.headers.get('range'))
  })

  registerIpcHandlers()
  applyAppIcon()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
