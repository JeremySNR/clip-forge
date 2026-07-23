import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { withRetries, withTimeout } from './openai'

/**
 * Keyless image search for B-roll. Wikipedia's page-image API is tried first —
 * for named entities ("Yoda", "Millennium Falcon") it returns the canonical
 * picture — with Openverse (Creative Commons aggregator) as fallback for
 * generic queries. Images are downloaded into the project folder so exports
 * keep working offline.
 */

const USER_AGENT = 'ClipForge/0.1 (open-source video clipper; https://github.com/clipforge)'

// Without a timeout, a request a corporate firewall silently drops hangs forever
// and freezes the whole B-roll stage. Fail fast instead so the clip just skips
// its image inserts. Downloads get longer as the payload is larger.
const SEARCH_TIMEOUT_MS = 15_000
const DOWNLOAD_TIMEOUT_MS = 30_000

export interface FoundImage {
  imageUrl: string
  sourceUrl: string
}

interface WikiQueryResponse {
  query?: {
    pages?: Record<
      string,
      {
        title?: string
        index?: number
        thumbnail?: { source?: string; width?: number; height?: number }
        fullurl?: string
      }
    >
  }
}

/** Exact title lookup ("Yoda" -> the Yoda article's lead image). */
async function lookupWikipediaTitle(title: string, signal?: AbortSignal): Promise<FoundImage | null> {
  const params = new URLSearchParams({
    action: 'query',
    titles: title,
    redirects: '1',
    prop: 'pageimages|info',
    inprop: 'url',
    piprop: 'thumbnail',
    pilicense: 'any',
    pithumbsize: '1400',
    format: 'json',
    origin: '*'
  })
  const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: withTimeout(SEARCH_TIMEOUT_MS, signal)
  })
  if (!res.ok) return null
  const data = (await res.json()) as WikiQueryResponse
  for (const page of Object.values(data.query?.pages ?? {})) {
    const thumb = page.thumbnail
    if (thumb?.source && (thumb.width ?? 0) >= 200 && (thumb.height ?? 0) >= 200) {
      return {
        imageUrl: thumb.source,
        sourceUrl: page.fullurl ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title ?? '')}`
      }
    }
  }
  return null
}

async function searchWikipedia(query: string, signal?: AbortSignal): Promise<FoundImage | null> {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrlimit: '4',
    gsrnamespace: '0',
    prop: 'pageimages|info',
    inprop: 'url',
    piprop: 'thumbnail',
    // Include fair-use lead images (e.g. film characters), not only free ones.
    pilicense: 'any',
    pithumbsize: '1400',
    format: 'json',
    origin: '*'
  })
  const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: withTimeout(SEARCH_TIMEOUT_MS, signal)
  })
  if (!res.ok) return null
  const data = (await res.json()) as WikiQueryResponse
  const pages = Object.values(data.query?.pages ?? {}).sort(
    (a, b) => (a.index ?? 99) - (b.index ?? 99)
  )
  // Fair-use lead images (film/TV characters) are often small and cannot be
  // scaled up by the API, so accept modest sizes rather than losing the most
  // relevant page.
  for (const page of pages) {
    const thumb = page.thumbnail
    if (thumb?.source && (thumb.width ?? 0) >= 200 && (thumb.height ?? 0) >= 200) {
      return {
        imageUrl: thumb.source,
        sourceUrl: page.fullurl ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title ?? '')}`
      }
    }
  }
  return null
}

interface OpenverseResponse {
  results?: Array<{
    url?: string
    foreign_landing_url?: string
    width?: number
    height?: number
  }>
}

async function searchOpenverse(query: string, signal?: AbortSignal): Promise<FoundImage | null> {
  const params = new URLSearchParams({
    q: query,
    page_size: '8',
    filter_dead: 'false'
  })
  const res = await fetch(`https://api.openverse.org/v1/images/?${params}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: withTimeout(SEARCH_TIMEOUT_MS, signal)
  })
  if (!res.ok) return null
  const data = (await res.json()) as OpenverseResponse
  for (const result of data.results ?? []) {
    if (result.url && (result.width ?? 0) >= 500) {
      return { imageUrl: result.url, sourceUrl: result.foreign_landing_url ?? result.url }
    }
  }
  return null
}

export async function searchImage(
  query: string,
  trigger?: string,
  signal?: AbortSignal
): Promise<FoundImage | null> {
  // The trigger word is often an exact article title ("Yoda") whose lead
  // image beats anything full-text search returns.
  if (trigger && trigger.length >= 3) {
    try {
      const direct = await lookupWikipediaTitle(trigger, signal)
      if (direct) return direct
    } catch {
      /* fall through */
    }
  }
  try {
    const wiki = await searchWikipedia(query, signal)
    if (wiki) return wiki
  } catch {
    /* fall through to Openverse */
  }
  try {
    return await searchOpenverse(query, signal)
  } catch {
    return null
  }
}

/** Download an image, returning the saved path or null when unusable. */
export async function downloadImage(
  imageUrl: string,
  destDir: string,
  fileBase: string,
  signal?: AbortSignal
): Promise<string | null> {
  try {
    return await withRetries(
      async () => {
        const res = await fetch(imageUrl, {
          headers: { 'User-Agent': USER_AGENT },
          signal: withTimeout(DOWNLOAD_TIMEOUT_MS, signal)
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const type = res.headers.get('content-type') ?? ''
        if (!type.startsWith('image/')) throw new Error(`not an image: ${type}`)
        const bytes = Buffer.from(await res.arrayBuffer())
        if (bytes.length < 4096) throw new Error('image too small')
        const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg'
        await mkdir(destDir, { recursive: true })
        const path = join(destDir, `${fileBase}.${ext}`)
        await writeFile(path, bytes)
        return path
      },
      { attempts: 2, baseDelayMs: 800, signal }
    )
  } catch {
    return null
  }
}
