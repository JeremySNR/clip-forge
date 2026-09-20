import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export interface ReleaseAsset {
  name: string
  size: number
  digest?: string | null
  browser_download_url: string
}

/** Only accept a verified DMG for this CPU from our own versioned release. */
export function macInstaller(assets: ReleaseAsset[], version: string, arch: string): ReleaseAsset | null {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !['arm64', 'x64'].includes(arch)) return null
  const names = arch === 'arm64'
    ? [`Cutawan-${version}-arm64.dmg`, `Cutawan-${version}-universal.dmg`]
    : [`Cutawan-${version}-x64.dmg`, `Cutawan-${version}.dmg`, `Cutawan-${version}-universal.dmg`]
  return assets.find((a) => names.includes(a.name) &&
    Number.isSafeInteger(a.size) && a.size > 0 && /^sha256:[a-f0-9]{64}$/.test(a.digest ?? '') &&
    a.browser_download_url === `https://github.com/JeremySNR/cutawan/releases/download/v${version}/${a.name}`
  ) ?? null
}

export async function verifyInstaller(path: string, asset: ReleaseAsset): Promise<boolean> {
  try {
    if ((await stat(path)).size !== asset.size) return false
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(path)) hash.update(chunk)
    return `sha256:${hash.digest('hex')}` === asset.digest
  } catch {
    return false
  }
}

/** Stream to disk, verify, then atomically expose the completed installer. */
export async function downloadMacInstaller(
  asset: ReleaseAsset,
  directory: string,
  onProgress: (progress: number) => void,
  signal: AbortSignal
): Promise<string> {
  // Enforce the boundary here too, even if a caller bypasses macInstaller.
  if (!/^Cutawan-[\d.]+(?:-(?:arm64|x64|universal))?\.dmg$/.test(asset.name) ||
      !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? '') ||
      !/^https:\/\/github\.com\/JeremySNR\/cutawan\/releases\/download\/v\d+\.\d+\.\d+\//.test(asset.browser_download_url) ||
      !asset.browser_download_url.endsWith(`/${asset.name}`) ||
      !Number.isSafeInteger(asset.size) || asset.size <= 0) throw new Error('Invalid installer metadata.')
  signal.throwIfAborted()
  await mkdir(directory, { recursive: true })
  const destination = join(directory, asset.name)
  if (await verifyInstaller(destination, asset)) {
    signal.throwIfAborted()
    onProgress(1)
    return destination
  }
  const temporary = `${destination}.partial`
  const controller = new AbortController()
  const combined = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(30 * 60_000)])
  let idleTimer = setTimeout(() => controller.abort(new Error('Download stalled. Please retry.')), 45_000)
  let received = 0
  let lastProgressAt = 0
  const hash = createHash('sha256')
  try {
    const response = await fetch(asset.browser_download_url, { signal: combined })
    if (!response.ok || !response.body) throw new Error(`Download failed (HTTP ${response.status}). Please retry.`)
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        clearTimeout(idleTimer)
        idleTimer = setTimeout(() => controller.abort(new Error('Download stalled. Please retry.')), 45_000)
        received += chunk.length
        if (received > asset.size) return callback(new Error('Installer size does not match the release.'))
        hash.update(chunk)
        if (Date.now() - lastProgressAt > 150) {
          lastProgressAt = Date.now()
          onProgress(Math.min(0.99, received / asset.size))
        }
        callback(null, chunk)
      }
    })
    await pipeline(Readable.fromWeb(response.body as never), meter,
      createWriteStream(temporary, { mode: 0o600 }), { signal: combined })
    if (received !== asset.size || `sha256:${hash.digest('hex')}` !== asset.digest) {
      throw new Error('Installer verification failed. Please retry the download.')
    }
    await rename(temporary, destination)
    onProgress(1)
    return destination
  } finally {
    clearTimeout(idleTimer)
    await rm(temporary, { force: true })
  }
}
