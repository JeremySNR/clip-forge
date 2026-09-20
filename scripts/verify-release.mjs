// Refuse to publish an incomplete release or a manifest pointing at bad bytes.
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
// electron-builder already uses js-yaml to generate these manifests.
const yaml = require('js-yaml')
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const directory = process.argv[2] ?? 'release'
const uploaded = process.argv[3] ? JSON.parse(await readFile(process.argv[3], 'utf8')).assets : null
if (process.argv[3] && !Array.isArray(uploaded)) throw new Error('Missing uploaded asset metadata')
const expected = {
  'latest-mac.yml': [`Cutawan-${version}-arm64.dmg`, `Cutawan-${version}-arm64-mac.zip`],
  'latest.yml': [`Cutawan-Setup-${version}.exe`],
  'latest-linux.yml': [`Cutawan-${version}.AppImage`]
}
for (const [manifest, required] of Object.entries(expected)) {
  const data = yaml.load(await readFile(join(directory, manifest), 'utf8'))
  if (data.version !== version || !Array.isArray(data.files)) throw new Error(`Invalid ${manifest}`)
  for (const name of required) {
    if (!data.files.some((file) => file.url === name)) throw new Error(`${manifest} is missing ${name}`)
  }
  for (const file of data.files) {
    if (typeof file.url !== 'string' || basename(file.url) !== file.url) throw new Error(`Invalid asset in ${manifest}`)
    const path = join(directory, file.url)
    if ((await stat(path)).size !== file.size) throw new Error(`Incorrect size: ${file.url}`)
    const hash = createHash('sha512')
    const sha256 = createHash('sha256')
    for await (const chunk of createReadStream(path)) { hash.update(chunk); sha256.update(chunk) }
    if (hash.digest('base64') !== file.sha512) throw new Error(`Incorrect checksum: ${file.url}`)
    if (uploaded) {
      const remote = uploaded.find((asset) => asset.name === file.url)
      if (!remote || remote.state !== 'uploaded' || remote.size !== file.size ||
          remote.digest !== `sha256:${sha256.digest('hex')}`) throw new Error(`Upload not verified: ${file.url}`)
    }
  }
}
console.log(`All v${version} installers and update manifests verified.`)
