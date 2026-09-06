import { describe, expect, it } from 'vitest'
// @ts-expect-error plain ESM helper, no declaration file
import { buildManifests } from '../scripts/print-winget-manifest.mjs'

const SHA = 'c0e801a93b2c26dbc529e16f0c6fcf25a560728132a5a05a444406488a5433b5'

describe('buildManifests', () => {
  const manifests = buildManifests({
    version: '0.7.0',
    installerUrl:
      'https://github.com/JeremySNR/clip-forge/releases/download/v0.7.0/ClipForge-Setup-0.7.0.exe',
    installerSha256: SHA,
    releaseUrl: 'https://github.com/JeremySNR/clip-forge/releases/tag/v0.7.0',
    publishedAt: '2026-09-02T06:20:17Z'
  })

  it('emits the winget-pkgs identifier and NSIS installer', () => {
    expect(manifests.versionYaml).toContain('PackageIdentifier: JeremySNR.ClipForge')
    expect(manifests.versionYaml).toContain('PackageVersion: 0.7.0')
    expect(manifests.installerYaml).toContain('InstallerType: nullsoft')
    expect(manifests.installerYaml).toContain('ClipForge-Setup-0.7.0.exe')
    expect(manifests.installerYaml).toContain(`InstallerSha256: ${SHA.toUpperCase()}`)
    expect(manifests.installerYaml).toContain('ReleaseDate: 2026-09-02')
  })

  it('fills locale metadata winget-pkgs requires', () => {
    expect(manifests.localeYaml).toContain('PackageName: ClipForge')
    expect(manifests.localeYaml).toContain('License: MIT')
    expect(manifests.localeYaml).toContain('Moniker: clipforge')
    expect(manifests.localeYaml).toContain(
      'https://github.com/JeremySNR/clip-forge/releases/tag/v0.7.0'
    )
  })
})
