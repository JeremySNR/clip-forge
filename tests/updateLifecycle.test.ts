import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  app: { isPackaged: true, getVersion: () => '1.0.0' },
  updater: {
    on: vi.fn(), removeListener: vi.fn(), checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(), quitAndInstall: vi.fn(),
    autoInstallOnAppQuit: true
  }
}))
vi.mock('electron', () => ({ app: mocks.app, shell: {} }))
vi.mock('electron-updater', () => ({ autoUpdater: mocks.updater }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv('CUTAWAN_FORCE_DEV_UPDATES', '1')
  mocks.updater.checkForUpdates.mockResolvedValue({ updateInfo: { version: '1.1.0' } })
  mocks.updater.downloadUpdate.mockResolvedValue([])
})

it('retains downloaded version in main, reports progress and installs only explicitly', async () => {
  const updates = await import('../src/main/updates')
  const states = vi.fn()
  const unsubscribe = updates.onUpdateDownloadState(states)
  mocks.updater.downloadUpdate.mockImplementationOnce(async () => {
    const listener = mocks.updater.on.mock.calls.find(([name]) => name === 'download-progress')![1]
    listener({ percent: 50 })
  })
  await updates.downloadUpdate()
  expect(states).toHaveBeenCalledWith(expect.objectContaining({ status: 'downloading', progress: 0.5 }))
  expect(updates.getUpdateDownloadState()).toMatchObject({ status: 'downloaded', version: '1.1.0', mode: 'restart' })
  expect(mocks.updater.autoInstallOnAppQuit).toBe(false)
  expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled()
  await updates.downloadUpdate()
  expect(mocks.updater.downloadUpdate).toHaveBeenCalledTimes(1)
  updates.installUpdate()
  expect(mocks.updater.quitAndInstall).toHaveBeenCalledTimes(1)
  unsubscribe()
})

it('recovers from download errors and surfaces installation errors while keeping restart available', async () => {
  const updates = await import('../src/main/updates')
  expect(() => updates.installUpdate()).toThrow('No downloaded update')
  mocks.updater.downloadUpdate.mockRejectedValueOnce(new Error('Connection lost'))
  await updates.downloadUpdate()
  expect(updates.getUpdateDownloadState()).toMatchObject({ status: 'error', error: 'Connection lost' })
  await updates.downloadUpdate()
  expect(updates.getUpdateDownloadState().status).toBe('downloaded')
  const listener = mocks.updater.on.mock.calls.find(([name]) => name === 'error')![1]
  listener(new Error('Installer could not start'))
  expect(updates.getUpdateDownloadState()).toMatchObject({ status: 'downloaded', error: expect.stringContaining('Installer could not start') })
})
