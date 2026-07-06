import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { ImportProgress, UpdateCheckResult, UpdateDownloadProgress } from '@shared/types'

/**
 * Update checking and in-app updating.
 *
 * Discovery always goes through the GitHub Releases REST API (works in every
 * run mode and drives the "Update available" UI). Installing depends on how
 * the app runs: packaged builds (AppImage/NSIS) download and swap themselves
 * via electron-updater; source checkouts pull, rebuild and relaunch in place.
 */

const REPO = 'JeremySNR/clip-forge'
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

/**
 * Walk upward from `start` until a `.git` directory/file is found.
 * Exported for tests.
 */
export function findGitRoot(start: string): string | null {
  let dir = resolve(start)
  while (true) {
    if (existsSync(join(dir, '.git'))) return dir
    const parent = resolve(dir, '..')
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * Locate the ClipForge git checkout root. `app.getAppPath()` often points at
 * `out/main` (next to the compiled main bundle), not the repo root where
 * `.git` lives — so we walk upward from several likely starting points.
 */
export function resolveSourceRepoRoot(): string | null {
  if (isAutoUpdateSupported()) return null
  const starts = new Set<string>([process.cwd()])
  const appPath = app?.getAppPath?.()
  if (appPath) starts.add(appPath)
  for (const start of starts) {
    const root = findGitRoot(start)
    if (!root || !existsSync(join(root, 'package.json'))) continue
    try {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name?: string }
      if (pkg.name === 'clipforge') return root
    } catch {
      /* try the next candidate */
    }
  }
  return null
}

/**
 * True when this copy is a git checkout the app can update in place: pull,
 * reinstall dependencies, rebuild, relaunch (the one-click update path for
 * source installs, where a packaged-style swap is impossible).
 */
export function isSourceUpdateSupported(): boolean {
  return !isAutoUpdateSupported()
}

/** Pure decision step, separated from the network fetch for tests. */
export function evaluateUpdate(
  currentVersion: string,
  release: GithubRelease | null,
  autoUpdateSupported = false,
  sourceUpdateSupported = false
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
    sourceUpdateSupported,
    error: null,
    checkedAt: Date.now()
  }
}

function currentVersion(): string {
  return app?.getVersion?.() ?? '0.0.0'
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  // Test hook: force a fake latest version without hitting the network.
  const fake = process.env.CLIPFORGE_FAKE_LATEST
  if (fake) {
    return evaluateUpdate(
      currentVersion(),
      { tag_name: fake, html_url: RELEASES_PAGE },
      isAutoUpdateSupported(),
      isSourceUpdateSupported()
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
    const token = process.env.CLIPFORGE_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN
    if (token) headers.Authorization = `Bearer ${token}`

    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers,
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS)
    })
    if (res.status === 404) {
      // No published releases yet: nothing to update to.
      return evaluateUpdate(version, null, isAutoUpdateSupported(), isSourceUpdateSupported())
    }
    if (!res.ok) {
      throw new Error(`GitHub responded with HTTP ${res.status}`)
    }
    return evaluateUpdate(
      version,
      (await res.json()) as GithubRelease,
      isAutoUpdateSupported(),
      isSourceUpdateSupported()
    )
  } catch (err) {
    return {
      currentVersion: version,
      latestVersion: null,
      updateAvailable: false,
      releaseUrl: null,
      autoUpdateSupported: isAutoUpdateSupported(),
      sourceUpdateSupported: isSourceUpdateSupported(),
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
  onProgress: (p: UpdateDownloadProgress) => void
): Promise<string> {
  if (!isAutoUpdateSupported()) {
    throw new Error(
      'This copy runs from a source checkout and cannot update itself — run "git pull", then rebuild.'
    )
  }
  if (downloading) throw new Error('An update download is already running.')
  if (downloadedVersion) return downloadedVersion

  const updater = configureAutoUpdater()
  downloading = true
  try {
    const check = await updater.checkForUpdates()
    const next = check?.updateInfo?.version
    if (!next || compareVersions(next, currentVersion()) <= 0) {
      throw new Error('No newer packaged build is available to download yet.')
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

/**
 * Node 20+ on Windows rejects spawning `.cmd`/`.bat` without `shell: true`
 * (CVE-2024-27980). Exported for tests.
 */
export function spawnStepOptions(
  cmd: string,
  cwd: string
): { cwd: string; windowsHide: boolean; shell?: boolean; env: NodeJS.ProcessEnv } {
  const shell =
    process.platform === 'win32' &&
    (cmd === 'npm' || cmd === 'npm.cmd' || /\.(cmd|bat)$/i.test(cmd))
  return {
    cwd,
    windowsHide: true,
    env: process.env,
    ...(shell ? { shell: true } : {})
  }
}

function runStep(
  cmd: string,
  args: string[],
  cwd: string
): Promise<string> {
  if (!existsSync(cwd)) {
    return Promise.reject(new Error(`Checkout folder not found: ${cwd}`))
  }
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, spawnStepOptions(cmd, cwd))
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
      if (stderr.length > 65536) stderr = stderr.slice(-32768)
    })
    child.on('error', (err) => {
      reject(
        new Error(
          `Could not run ${cmd}: ${err instanceof Error ? err.message : String(err)}`
        )
      )
    })
    child.on('close', (code) => {
      if (code === 0) return resolve(stdout)
      const detail = stderr.split('\n').filter(Boolean).slice(-3).join(' ').trim()
      reject(new Error(`"${cmd} ${args.join(' ')}" failed: ${detail || `exit code ${code}`}`))
    })
  })
}

const npmCmd = 'npm'
let sourceUpdateRunning = false

/**
 * One-click update for source checkouts: fast-forward the repo, reinstall
 * dependencies, rebuild, then relaunch. Only manifest/build-cache churn is
 * discarded automatically (the classic blocked-pull culprit); real local
 * edits abort the update with a clear message instead of being destroyed.
 */
export async function updateFromSource(onProgress: (p: ImportProgress) => void): Promise<void> {
  if (!isSourceUpdateSupported()) {
    throw new Error('Packaged installs update via download and restart, not git pull.')
  }
  const root = resolveSourceRepoRoot()
  if (!root) {
    throw new Error(
      'This folder is not a git checkout (no .git directory found). Clone the repo with git clone, or download the AppImage from the releases page.'
    )
  }
  if (sourceUpdateRunning) throw new Error('An update is already running.')
  sourceUpdateRunning = true
  try {
    onProgress({ progress: -1, message: 'Checking the local checkout…' })
    const dirty = (await runStep('git', ['status', '--porcelain'], root))
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    const churn = ['package-lock.json', 'package.json']
    const discardable = dirty.filter((l) => churn.some((f) => l.endsWith(f)))
    const blocking = dirty.filter(
      (l) => !churn.some((f) => l.endsWith(f)) && !l.startsWith('??')
    )
    if (blocking.length > 0) {
      throw new Error(
        `You have local changes the update would overwrite (${blocking
          .map((l) => l.split(/\s+/).pop())
          .join(', ')}). Commit or stash them, then retry.`
      )
    }
    // npm rewrites manifests on install; local churn there is safe to drop.
    if (discardable.length > 0) {
      await runStep('git', ['checkout', '--', 'package-lock.json', 'package.json'], root)
    }

    onProgress({ progress: -1, message: 'Pulling the latest code…' })
    await runStep('git', ['pull', '--ff-only'], root)

    onProgress({ progress: -1, message: 'Installing dependencies…' })
    await runStep(npmCmd, ['install', '--no-audit', '--no-fund'], root)

    onProgress({ progress: -1, message: 'Rebuilding the app…' })
    await runStep(npmCmd, ['run', 'build'], root)

    onProgress({ progress: 1, message: 'Restarting…' })
    // Let the IPC reply and the "Restarting…" frame land before swapping.
    setTimeout(() => {
      app.relaunch()
      app.exit(0)
    }, 800)
  } finally {
    sourceUpdateRunning = false
  }
}
