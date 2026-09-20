import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  download: vi.fn(), verify: vi.fn(), open: vi.fn(), reveal: vi.fn()
}))
vi.mock('electron', () => ({
  app: { isPackaged: true, getVersion: () => '1.0.0', getPath: () => '/tmp/cutawan-test-profile' },
  shell: { openPath: mocks.open, showItemInFolder: mocks.reveal }
}))
vi.mock('../src/main/macUpdate', async (original) => ({
  ...await original<typeof import('../src/main/macUpdate')>(),
  downloadMacInstaller: mocks.download, verifyInstaller: mocks.verify
}))
const originalPlatform = process.platform
const originalArch = process.arch
const asset = {
  name: 'Cutawan-1.2.3-arm64.dmg', size: 123, digest: `sha256:${'a'.repeat(64)}`,
  browser_download_url: 'https://github.com/JeremySNR/cutawan/releases/download/v1.2.3/Cutawan-1.2.3-arm64.dmg'
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  Object.defineProperty(process, 'arch', { value: 'arm64' })
  vi.stubEnv('CUTAWAN_FORCE_DEV_UPDATES', '')
  vi.stubEnv('CUTAWAN_FAKE_LATEST', '')
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Response(JSON.stringify({
    tag_name: 'v1.2.3', assets: [asset], html_url: 'https://github.com/JeremySNR/cutawan/releases/tag/v1.2.3'
  }))))
  mocks.verify.mockResolvedValue(false)
  mocks.download.mockResolvedValue('/tmp/verified.dmg')
  mocks.open.mockResolvedValue('')
})
afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform })
  Object.defineProperty(process, 'arch', { value: originalArch })
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it('discovers, downloads and opens the verified Mac installer through main-process state', async () => {
  const updates = await import('../src/main/updates')
  expect(await updates.checkForUpdates()).toMatchObject({ manualDownloadSupported: true, autoUpdateSupported: false })
  expect(await updates.downloadUpdate()).toMatchObject({ status: 'downloaded', mode: 'manual', version: '1.2.3' })
  expect(mocks.download).toHaveBeenCalledWith(asset, expect.stringContaining('updates'), expect.any(Function), expect.any(AbortSignal))
  mocks.verify.mockResolvedValue(true)
  await updates.openUpdateInstaller()
  expect(mocks.open).toHaveBeenCalledWith('/tmp/verified.dmg')
  expect(() => updates.installUpdate()).toThrow('No downloaded update')
})

it('restores a verified cached installer but refuses to open it after tampering', async () => {
  const updates = await import('../src/main/updates')
  mocks.verify.mockResolvedValue(true)
  await updates.checkForUpdates()
  expect(updates.getUpdateDownloadState()).toMatchObject({ status: 'downloaded', version: '1.2.3' })
  expect(mocks.download).not.toHaveBeenCalled()
  mocks.verify.mockResolvedValue(false)
  await expect(updates.openUpdateInstaller()).rejects.toThrow('verification failed')
  expect(mocks.open).not.toHaveBeenCalled()
  expect(updates.getUpdateDownloadState().status).toBe('error')
})

it('reports installer-open failures and reveals the verified file in Finder', async () => {
  const updates = await import('../src/main/updates')
  await updates.downloadUpdate()
  mocks.verify.mockResolvedValue(true)
  mocks.open.mockResolvedValue('DiskImageMounter unavailable')
  await expect(updates.openUpdateInstaller()).rejects.toThrow('revealed in Finder')
  expect(mocks.reveal).toHaveBeenCalledWith('/tmp/verified.dmg')
})
