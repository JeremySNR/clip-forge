import { app, BrowserWindow, net, protocol, shell } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerIpcHandlers } from './ipc'

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
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: { secure: true, supportFetchAPI: true, stream: true, bypassCSP: true }
  }
])

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#09090b',
    title: 'ClipForge',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
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
  protocol.handle('media', (request) => {
    const url = new URL(request.url)
    const filePath = decodeURIComponent(url.pathname.replace(/^\//, ''))
    return net.fetch(pathToFileURL(filePath).toString())
  })

  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
