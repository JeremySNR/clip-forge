/** Downloads and verifies a real release without opening or installing it. */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadMacInstaller, macInstaller, verifyInstaller, type ReleaseAsset } from '../src/main/macUpdate'

async function main(): Promise<void> {
  const response = await fetch('https://api.github.com/repos/JeremySNR/cutawan/releases/latest', {
    headers: { 'User-Agent': 'Cutawan-update-check' }, signal: AbortSignal.timeout(10_000)
  })
  if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`)
  const release = await response.json() as { tag_name: string; assets: ReleaseAsset[] }
  const asset = macInstaller(release.assets, release.tag_name.replace(/^v/, ''), process.arch)
  if (!asset) throw new Error('No verified installer for this architecture')
  const directory = await mkdtemp(join(tmpdir(), 'cutawan-real-update-'))
  let last = -1
  const path = await downloadMacInstaller(asset, directory, (progress) => {
    const step = Math.floor(progress * 10)
    if (step !== last) { last = step; console.log(`Downloaded ${Math.round(progress * 100)}%`) }
  }, new AbortController().signal)
  if (!await verifyInstaller(path, asset)) throw new Error('Post-download verification failed')
  console.log(`Verified ${asset.size} bytes for ${release.tag_name}: ${path}`)
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
