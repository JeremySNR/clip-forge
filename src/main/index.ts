import { app, BrowserWindow, net, protocol, shell } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerIpcHandlers } from './ipc'

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
