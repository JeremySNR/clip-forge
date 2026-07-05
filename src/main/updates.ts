import { app } from 'electron'
import type { UpdateCheckResult } from '@shared/types'

/**
 * Update checking against GitHub Releases. The app has no auto-updater
 * infrastructure, so "updating" means sending the user to the release page;
 * this module only answers "is there a newer published version?".
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

/** Pure decision step, separated from the network fetch for tests. */
export function evaluateUpdate(
  currentVersion: string,
  release: GithubRelease | null
): UpdateCheckResult {
  const tag = release?.tag_name?.trim() || null
  const usable = tag !== null && !release?.draft && !release?.prerelease
  const latestVersion = usable ? tag.replace(/^v/i, '') : null
  return {
    currentVersion,
    latestVersion,
    updateAvailable: latestVersion !== null && compareVersions(latestVersion, currentVersion) > 0,
    releaseUrl: (usable ? release?.html_url : null) ?? (latestVersion ? RELEASES_PAGE : null),
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
    return evaluateUpdate(currentVersion(), { tag_name: fake, html_url: RELEASES_PAGE })
  }

  const version = currentVersion()
  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      // GitHub's API rejects requests without a User-Agent.
      'User-Agent': `ClipForge/${version}`
    }
    // While the repository is private, unauthenticated requests 404; a token
    // from the environment lets those installs see releases too.
    const token = process.env.CLIPFORGE_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN
    if (token) headers.Authorization = `Bearer ${token}`

    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers,
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS)
    })
    if (res.status === 404) {
      // No published releases yet: nothing to update to.
      return evaluateUpdate(version, null)
    }
    if (!res.ok) {
      throw new Error(`GitHub responded with HTTP ${res.status}`)
    }
    return evaluateUpdate(version, (await res.json()) as GithubRelease)
  } catch (err) {
    return {
      currentVersion: version,
      latestVersion: null,
      updateAvailable: false,
      releaseUrl: null,
      error: `Could not check for updates: ${err instanceof Error ? err.message : String(err)}`,
      checkedAt: Date.now()
    }
  }
}
