import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateCheckResult, UpdateDownloadProgress } from '@shared/types'

/**
 * Update checking and in-app updating.
 *
 * Discovery always goes through the GitHub Releases REST API (works in every
 * run mode and drives the "Update available" UI). Installing depends on how
 * the app runs: packaged builds (AppImage/NSIS) download and swap themselves
 * via electron-updater using the release's electron-builder metadata
 * (latest-linux.yml etc.); source checkouts cannot self-update, so the UI
 * links to the release page and suggests pulling instead.
 */

const REPO = 'JeremySNR/j-clip'
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`
const CHECK_TIMEOUT_MS = 10_000

interface GithubRelease {
  tag_name?: string
  html_url?: string
  draft?: boolean
  prerelease?: boolean
}

/**
 * Compare dotted numeric versions ("v" prefix and any pre-release/build
 * suffix are ignored). Returns <0, 0 or >0 like a comparator. Exported for
 * tests.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v
      .trim()
      .replace(/^v/i, '')
      .split(/[-+]/)[0]
      .split('.')
      .map((p) => Number.parseInt(p, 10) || 0)
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/**
 * True when this process can replace itself with a downloaded update:
 * packaged builds only. The env hook lets tests exercise the download flow
 * from a source checkout via electron-updater's dev-update config.
 */
export function isAutoUpdateSupported(): boolean {
  return app?.isPackaged === true || process.env.CLIPFORGE_FORCE_DEV_UPDATES === '1'
}

/** Pure decision step, separated from the network fetch for tests. */
export function evaluateUpdate(
  currentVersion: string,
  release: GithubRelease | null,
  autoUpdateSupported = false
): UpdateCheckResult {
  const tag = release?.tag_name?.trim() || null
  const usable = tag !== null && !release?.draft && !release?.prerelease
  const latestVersion = usable ? tag.replace(/^v/i, '') : null
  return {
    currentVersion,
    latestVersion,
    updateAvailable: latestVersion !== null && compareVersions(latestVersion, currentVersion) > 0,
    releaseUrl: (usable ? release?.html_url : null) ?? (latestVersion ? RELEASES_PAGE : null),
    autoUpdateSupported,
    error: null,
    checkedAt: Date.now()
  }
}

function currentVersion(): string {
  return app?.getVersion?.() ?? '0.0.0'
}

function githubAuthToken(): string | undefined {
  const token = process.env.CLIPFORGE_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  return token?.trim() || undefined
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  // Test hook: force a fake latest version without hitting the network.
  const fake = process.env.CLIPFORGE_FAKE_LATEST
  if (fake) {
    return evaluateUpdate(
      currentVersion(),
      { tag_name: fake, html_url: RELEASES_PAGE },
      isAutoUpdateSupported()
    )
  }

  const version = currentVersion()
  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      // GitHub's API rejects requests without a User-Agent.
      'User-Agent': `ClipForge/${version}`
    }
    // Unauthenticated requests 404 on private repos; a token from the
    // environment lets installs of a private fork see releases too.
    const token = githubAuthToken()
    if (token) headers.Authorization = `Bearer ${token}`

    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers,
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS)
    })
    if (res.status === 404) {
      // No published releases yet: nothing to update to.
      return evaluateUpdate(version, null, isAutoUpdateSupported())
    }
    if (!res.ok) {
      throw new Error(`GitHub responded with HTTP ${res.status}`)
    }
    return evaluateUpdate(version, (await res.json()) as GithubRelease, isAutoUpdateSupported())
  } catch (err) {
    return {
      currentVersion: version,
      latestVersion: null,
      updateAvailable: false,
      releaseUrl: null,
      autoUpdateSupported: isAutoUpdateSupported(),
      error: `Could not check for updates: ${err instanceof Error ? err.message : String(err)}`,
      checkedAt: Date.now()
    }
  }
}

let downloading = false
let downloadedVersion: string | null = null

function configureAutoUpdater(): typeof autoUpdater {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.fullChangelog = false
  const token = githubAuthToken()
  if (token) {
    if (!process.env.GH_TOKEN) process.env.GH_TOKEN = token
    autoUpdater.addAuthHeader(`Bearer ${token}`)
  }
  if (process.env.CLIPFORGE_FORCE_DEV_UPDATES === '1') {
    // Dev/test only: read the feed from dev-app-update.yml instead of the
    // packaged app-update.yml.
    autoUpdater.forceDevUpdateConfig = true
  }
  return autoUpdater
}

/**
 * Download the pending update in the background. Resolves with the version
 * that is ready to install; the renderer then offers "Restart to update".
 */
export async function downloadUpdate(
  onProgress: (p: UpdateDownloadProgress) => void,
  expectedVersion?: string
): Promise<string> {
  if (!isAutoUpdateSupported()) {
    throw new Error(
      'This copy runs from a source checkout and cannot update itself — run "git pull", then rebuild.'
    )
  }
  if (downloading) throw new Error('An update download is already running.')
  const requestedVersion = expectedVersion?.trim() || null
  if (
    downloadedVersion &&
    (requestedVersion === null || compareVersions(downloadedVersion, requestedVersion) === 0)
  ) {
    return downloadedVersion
  }

  const updater = configureAutoUpdater()
  downloading = true
  try {
    const check = await updater.checkForUpdates()
    const next = check?.updateInfo?.version
    if (!next || compareVersions(next, currentVersion()) <= 0) {
      throw new Error('No newer packaged build is available to download yet.')
    }
    if (requestedVersion !== null && compareVersions(next, requestedVersion) !== 0) {
      throw new Error(
        `Packaged update metadata is for v${next}, but GitHub latest is v${requestedVersion}. ` +
          'Try again shortly or use the release page.'
      )
    }
    const progressListener = (p: { percent: number }): void =>
      onProgress({ progress: Math.min(1, p.percent / 100) })
    updater.on('download-progress', progressListener)
    try {
      await updater.downloadUpdate()
    } finally {
      updater.removeListener('download-progress', progressListener)
    }
    downloadedVersion = next
    return next
  } finally {
    downloading = false
  }
}

/** Quit and swap in the downloaded update (no-op if none is downloaded). */
export function installUpdate(): void {
  if (!downloadedVersion) throw new Error('No downloaded update to install.')
  configureAutoUpdater().quitAndInstall()
}
