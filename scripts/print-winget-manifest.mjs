/**
 * Prints a winget-pkgs manifest trio (version + installer + locale) for the
 * latest (or a given) GitHub release. Used for the first submit to
 * microsoft/winget-pkgs; later versions are published by the Release
 * workflow once WINGET_TOKEN is set (see docs/winget.md).
 *
 * Usage:
 *   node scripts/print-winget-manifest.mjs            # latest release
 *   node scripts/print-winget-manifest.mjs 0.7.0      # specific version
 *
 * Writes YAML to stdout as three files separated by banners, or to a
 * directory if --out DIR is passed.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const PACKAGE_ID = 'JeremySNR.ClipForge'
const OWNER = 'JeremySNR'
const REPO = 'clip-forge'
const PUBLISHER = 'Jeremy Smith'
const PACKAGE_NAME = 'ClipForge'

const args = process.argv.slice(2)
let versionArg = null
let outDir = null
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') {
    outDir = args[++i]
    continue
  }
  if (!args[i].startsWith('-')) versionArg = args[i]
}

function sha256Of(asset) {
  const digest = asset.digest
  if (typeof digest === 'string' && digest.startsWith('sha256:')) return digest.slice(7)
  throw new Error(`Release asset ${asset.name} has no sha256 digest`)
}

export function buildManifests({ version, installerUrl, installerSha256, releaseUrl, publishedAt }) {
  const date = (publishedAt ?? new Date().toISOString()).slice(0, 10)
  const versionYaml = `PackageIdentifier: ${PACKAGE_ID}
PackageVersion: ${version}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.6.0
`

  const installerYaml = `PackageIdentifier: ${PACKAGE_ID}
PackageVersion: ${version}
InstallerLocale: en-US
InstallerType: nullsoft
Scope: user
UpgradeBehavior: install
ReleaseDate: ${date}
Installers:
  - Architecture: x64
    InstallerUrl: ${installerUrl}
    InstallerSha256: ${installerSha256.toUpperCase()}
ManifestType: installer
ManifestVersion: 1.6.0
`

  const localeYaml = `PackageIdentifier: ${PACKAGE_ID}
PackageVersion: ${version}
PackageLocale: en-US
Publisher: ${PUBLISHER}
PublisherUrl: https://github.com/${OWNER}
PublisherSupportUrl: https://github.com/${OWNER}/${REPO}/issues
Author: ${PUBLISHER}
PackageName: ${PACKAGE_NAME}
PackageUrl: https://github.com/${OWNER}/${REPO}
License: MIT
LicenseUrl: https://github.com/${OWNER}/${REPO}/blob/main/LICENSE
Copyright: Copyright (c) ClipForge Contributors
ShortDescription: Open-source Opus Clip alternative. Turn long videos into vertical clips on your desktop.
Description: Turn podcasts, webinars, streams and interviews into ready-to-post vertical clips. AI-picked moments, virality scores, animated captions, auto zoom and speaker-aware reframing. Runs on your machine; you bring an OpenAI API key.
Moniker: clipforge
Tags:
  - video
  - captions
  - clips
  - electron
  - openai
ReleaseNotesUrl: ${releaseUrl}
ManifestType: defaultLocale
ManifestVersion: 1.6.0
`

  return { versionYaml, installerYaml, localeYaml }
}

async function githubJson(path) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'clipforge-winget' }
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GH_TOKEN || process.env.GITHUB_TOKEN}`
  }
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/${path}`, { headers })
  if (!res.ok) throw new Error(`GitHub API ${path} failed: HTTP ${res.status}`)
  return res.json()
}

async function main() {
  const release = versionArg
    ? await githubJson(`releases/tags/v${versionArg.replace(/^v/, '')}`)
    : await githubJson('releases/latest')
  const version = String(release.tag_name ?? '').replace(/^v/, '')
  const installer = (release.assets ?? []).find((a) => /^ClipForge-Setup-.*\.exe$/.test(a.name))
  if (!installer) {
    throw new Error(`No ClipForge-Setup-*.exe on ${release.tag_name}`)
  }
  const manifests = buildManifests({
    version,
    installerUrl: installer.browser_download_url,
    installerSha256: sha256Of(installer),
    releaseUrl: release.html_url,
    publishedAt: release.published_at
  })

  const files = [
    [`${PACKAGE_ID}.yaml`, manifests.versionYaml],
    [`${PACKAGE_ID}.installer.yaml`, manifests.installerYaml],
    [`${PACKAGE_ID}.locale.en-US.yaml`, manifests.localeYaml]
  ]

  if (outDir) {
    await mkdir(outDir, { recursive: true })
    for (const [name, body] of files) {
      await writeFile(join(outDir, name), body, 'utf8')
    }
    console.error(`Wrote ${files.length} files to ${outDir}`)
    return
  }

  for (const [name, body] of files) {
    process.stdout.write(`# --- ${name} ---\n${body}\n`)
  }
}

const isMain = process.argv[1] && process.argv[1].endsWith('print-winget-manifest.mjs')
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
