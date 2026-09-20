import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadMacInstaller, macInstaller, verifyInstaller, type ReleaseAsset } from '../src/main/macUpdate'

const bytes = Buffer.from('test installer contents')
function asset(arch = 'arm64'): ReleaseAsset {
  const name = `Cutawan-1.2.3-${arch}.dmg`
  return { name, size: bytes.length, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    browser_download_url: `https://github.com/JeremySNR/cutawan/releases/download/v1.2.3/${name}` }
}
const directories: string[] = []
async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'cutawan-update-'))
  directories.push(path)
  return path
}
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('Mac installer selection', () => {
  it('selects the running architecture and never gives Intel an ARM installer', () => {
    expect(macInstaller([asset()], '1.2.3', 'arm64')).toEqual(asset())
    expect(macInstaller([asset()], '1.2.3', 'x64')).toBeNull()
    expect(macInstaller([asset('x64'), asset()], '1.2.3', 'x64')).toEqual(asset('x64'))
  })
  it('rejects wrong versions, untrusted URLs and missing checksums', () => {
    expect(macInstaller([asset()], '1.2.4', 'arm64')).toBeNull()
    expect(macInstaller([{ ...asset(), digest: undefined }], '1.2.3', 'arm64')).toBeNull()
    expect(macInstaller([{ ...asset(), browser_download_url: 'https://example.com/file.dmg' }], '1.2.3', 'arm64')).toBeNull()
  })
})

describe('verified downloads', () => {
  it('streams, verifies and reuses an intact cached download', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(bytes))
    vi.stubGlobal('fetch', fetch)
    const dir = await directory()
    const progress = vi.fn()
    const path = await downloadMacInstaller(asset(), dir, progress, new AbortController().signal)
    expect(await readFile(path)).toEqual(bytes)
    expect(progress).toHaveBeenLastCalledWith(1)
    expect(await downloadMacInstaller(asset(), dir, progress, new AbortController().signal)).toBe(path)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('rejects corrupt and truncated downloads, cleans partial files, and permits retry', async () => {
    const fetch = vi.fn().mockImplementationOnce(() => new Response(Buffer.alloc(bytes.length)))
      .mockImplementationOnce(() => new Response(bytes.subarray(0, 5)))
      .mockImplementationOnce(() => new Response(bytes))
    vi.stubGlobal('fetch', fetch)
    const dir = await directory()
    for (let i = 0; i < 2; i++) {
      await expect(downloadMacInstaller(asset(), dir, vi.fn(), new AbortController().signal)).rejects.toThrow('verification failed')
      expect(await readdir(dir)).toEqual([])
    }
    const path = await downloadMacInstaller(asset(), dir, vi.fn(), new AbortController().signal)
    await writeFile(path, Buffer.alloc(bytes.length))
    expect(await verifyInstaller(path, asset())).toBe(false)
  })
  it('cleans partial downloads after network failure or cancellation', async () => {
    const dir = await directory()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })))
    await expect(downloadMacInstaller(asset(), dir, vi.fn(), new AbortController().signal)).rejects.toThrow('503')
    expect(await readdir(dir)).toEqual([])
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      controller.abort()
      return new Response(bytes)
    }))
    await expect(downloadMacInstaller(asset(), dir, vi.fn(), controller.signal)).rejects.toThrow()
    expect(await readdir(dir)).toEqual([])
  })
})
