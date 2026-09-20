import { afterEach, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { version } from '../package.json'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

it('allows complete releases and blocks missing or corrupt platform installers', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cutawan-release-'))
  directories.push(dir)
  const payload = Buffer.from('fixture release bytes')
  const manifests = {
    'latest-mac.yml': [`Cutawan-${version}-arm64.dmg`, `Cutawan-${version}-arm64-mac.zip`],
    'latest.yml': [`Cutawan-Setup-${version}.exe`],
    'latest-linux.yml': [`Cutawan-${version}.AppImage`]
  }
  for (const [name, files] of Object.entries(manifests)) {
    for (const file of files) await writeFile(join(dir, file), payload)
    await writeFile(join(dir, name), JSON.stringify({ version, files: files.map((url) => ({
      url, size: payload.length, sha512: createHash('sha512').update(payload).digest('base64')
    })) }))
  }
  const run = (): string => execFileSync(process.execPath, ['scripts/verify-release.mjs', dir], { encoding: 'utf8', stdio: 'pipe' })
  expect(run()).toContain('verified')
  const assets = Object.values(manifests).flat().map((name) => ({
    name, state: 'uploaded', size: payload.length,
    digest: `sha256:${createHash('sha256').update(payload).digest('hex')}`
  }))
  const remote = join(dir, 'uploaded.json')
  await writeFile(remote, JSON.stringify({ assets }))
  const runUploaded = (): string => execFileSync(process.execPath, ['scripts/verify-release.mjs', dir, remote], { encoding: 'utf8', stdio: 'pipe' })
  expect(runUploaded()).toContain('verified')
  assets[0].digest = ''
  await writeFile(remote, JSON.stringify({ assets }))
  expect(runUploaded).toThrow('Upload not verified')
  const windows = join(dir, manifests['latest.yml'][0])
  await writeFile(windows, Buffer.alloc(payload.length))
  expect(run).toThrow('Incorrect checksum')
  await rm(windows)
  expect(run).toThrow('ENOENT')
})
