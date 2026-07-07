import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { WorkvivoPostResult, WorkvivoSpace, WorkvivoTestResult } from '@shared/types'

/**
 * Minimal WorkVivo Customer API client using Node's built-in fetch (no SDK).
 *
 * Contract verified against WorkVivo's official API spec (the developer portal
 * is a published Postman collection) and corroborated by Zoom's own
 * `zoom/workvivo-zoom-integration`.
 *
 * Host: the Customer API is served from a central, region-specific host,
 * `https://api.workvivo.<region>/v1`, NOT the tenant's own web subdomain. Region
 * is encoded in the tenant TLD: `*.workvivo.com` (EU/global) → api.workvivo.com,
 * `*.workvivo.us` (US) → api.workvivo.us. See `deriveWorkvivoApiBase`.
 *
 * Auth: every request carries a Bearer token plus a `Workvivo-Id` header (the
 * organisation id). This is an org-level app token, not the user's interactive
 * SSO login, so posts are attributed to a configured identity (`user_id`)
 * rather than whoever clicks.
 *
 * Endpoints:
 * - `GET /spaces?skip=&take=` — list spaces (powers the picker + validates the
 *   connection). Shape: `{ data: [{ id, name, … }] }`.
 * - `POST /updates` ("Create an update") — create a feed post targeted at a
 *   space, as `multipart/form-data`. Required fields: `text`, `created_at`
 *   (`YYYY-MM-DDTHH:MM:SSZ` UTC), and a `user_id` (or `user_external_id`) to
 *   attribute the post to. A space is targeted via the audience array:
 *   `audience[type]=spaces` and `audience[spaces][0]=<space id>`. The `video`
 *   file is attached the same way; WorkVivo transcodes it, so there is a delay
 *   before it appears on the feed. Success is `201` with `{ data: { id, … } }`.
 */

/** Feed-post endpoint and its field names, kept in one place (see file header). */
const UPDATES_ENDPOINT = 'updates'
const FIELD_TEXT = 'text'
const FIELD_CREATED_AT = 'created_at'
const FIELD_USER_ID = 'user_id'
const FIELD_VIDEO = 'video'
const FIELD_AUDIENCE_TYPE = 'audience[type]'
const AUDIENCE_TYPE_SPACES = 'spaces'
/** WorkVivo targets an audience via an indexed array, e.g. `audience[spaces][0]`. */
const fieldAudienceSpace = (index: number): string => `audience[spaces][${index}]`

export interface WorkvivoRequestConfig {
  /** Fully-qualified API base, e.g. https://api.workvivo.com/v1. */
  apiBase: string
  /** Organisation id sent as the `Workvivo-Id` header. */
  companyId: string
  /** Bearer token. */
  token: string
}

export class WorkvivoError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message)
    this.name = 'WorkvivoError'
  }
}

/**
 * Derive the WorkVivo Customer API base URL from an organisation's WorkVivo
 * address. The API is NOT served from the tenant's own web subdomain; it lives
 * on a central, region-specific host `https://api.workvivo.<region>/v1`, where
 * region is taken from the tenant TLD (`*.workvivo.com` → com, `*.workvivo.us`
 * → us). So `https://acme.workvivo.com` → `https://api.workvivo.com/v1`.
 *
 * Accepts a full URL or a bare host, with or without a path. Anything that is
 * not a WorkVivo host defaults to the `.com` (EU/global) region. Returns null
 * only when the value is not a usable host. Exported for tests.
 */
export function deriveWorkvivoApiBase(url: string | undefined): string | null {
  const raw = url?.trim()
  if (!raw) return null
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const u = new URL(withScheme)
    const host = u.hostname.toLowerCase()
    if (!host.includes('.')) return null
    const region = host.match(/workvivo\.(com|us|io)$/)?.[1] ?? 'com'
    return `https://api.workvivo.${region}/v1`
  } catch {
    return null
  }
}

function authHeaders(config: WorkvivoRequestConfig): Record<string, string> {
  return {
    'Workvivo-Id': config.companyId,
    Authorization: `Bearer ${config.token}`,
    Accept: 'application/json'
  }
}

async function raiseForStatus(res: Response, context: string): Promise<never> {
  let detail = ''
  try {
    const body = (await res.json()) as {
      message?: string
      error?: string
      meta?: { errors?: unknown }
    }
    detail = body.message ?? body.error ?? (body.meta?.errors ? JSON.stringify(body.meta.errors) : '')
  } catch {
    /* non-JSON error body */
  }
  if (res.status === 401) {
    throw new WorkvivoError('WorkVivo rejected the API key. Check the token in Settings.', 401)
  }
  if (res.status === 403) {
    throw new WorkvivoError(
      `WorkVivo denied the request (HTTP 403)${detail ? `: ${detail}` : ''}. The API token most likely lacks permission to create posts — ask your WorkVivo admin to grant it write/create access for updates (feed posts).`,
      403
    )
  }
  if (res.status === 404) {
    throw new WorkvivoError(
      `WorkVivo endpoint not found (HTTP 404). This usually means the wrong region — check your WorkVivo URL's domain matches your tenant (.com for EU/global, .us for US).`,
      404
    )
  }
  if (res.status === 413) {
    throw new WorkvivoError(
      `WorkVivo rejected the upload as too large (HTTP 413). The video exceeds the API's request size limit.`,
      413
    )
  }
  throw new WorkvivoError(`${context} failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}`, res.status)
}

interface RawSpace {
  id: string | number
  name?: string
  title?: string
  display_name?: string
}

/** Normalise a WorkVivo space record from any of the observed name fields. */
function toSpace(raw: RawSpace): WorkvivoSpace | null {
  if (raw?.id === undefined || raw.id === null) return null
  const name = raw.name ?? raw.title ?? raw.display_name ?? `Space ${raw.id}`
  return { id: String(raw.id), name }
}

const SPACES_PAGE_SIZE = 100

/** List all spaces the token can post to. */
export async function listSpaces(
  config: WorkvivoRequestConfig,
  signal?: AbortSignal
): Promise<WorkvivoSpace[]> {
  const spaces: WorkvivoSpace[] = []
  for (let skip = 0; ; skip += SPACES_PAGE_SIZE) {
    const res = await fetch(`${config.apiBase}/spaces?skip=${skip}&take=${SPACES_PAGE_SIZE}`, {
      method: 'GET',
      headers: authHeaders(config),
      signal
    })
    if (!res.ok) await raiseForStatus(res, 'Listing WorkVivo spaces')
    const body = (await res.json()) as { data?: RawSpace[] }
    const page = body.data ?? []
    spaces.push(...page.map(toSpace).filter((s): s is WorkvivoSpace => s !== null))
    if (page.length < SPACES_PAGE_SIZE) break
  }
  spaces.sort((a, b) => a.name.localeCompare(b.name))
  return spaces
}

export interface WorkvivoUser {
  id: string
  name: string
}

/**
 * Resolve a WorkVivo user id from an email address, to populate the "Post as"
 * setting (WorkVivo requires posts to be attributed to a user). Uses the
 * documented `GET /users/by-email/:email` endpoint.
 */
export async function findUserByEmail(
  config: WorkvivoRequestConfig,
  email: string,
  signal?: AbortSignal
): Promise<WorkvivoUser> {
  const res = await fetch(`${config.apiBase}/users/by-email/${encodeURIComponent(email)}`, {
    method: 'GET',
    headers: authHeaders(config),
    signal
  })
  if (res.status === 404) {
    throw new WorkvivoError('No WorkVivo user found with that email address.', 404)
  }
  if (!res.ok) await raiseForStatus(res, 'Looking up WorkVivo user')
  const body = (await res.json()) as {
    data?: { id?: string | number; name?: string; display_name?: string }
  }
  const user = body.data
  if (!user || user.id === undefined || user.id === null) {
    throw new WorkvivoError('No WorkVivo user found with that email address.')
  }
  return { id: String(user.id), name: user.name ?? user.display_name ?? String(user.id) }
}

/** Validate the connection by listing spaces. Never throws. */
export async function testConnection(
  config: WorkvivoRequestConfig,
  signal?: AbortSignal
): Promise<WorkvivoTestResult> {
  try {
    const spaces = await listSpaces(config, signal)
    return {
      ok: true,
      message: `Connected — ${spaces.length} space${spaces.length === 1 ? '' : 's'} available.`,
      spaceCount: spaces.length
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

/** Pull a shareable post link out of WorkVivo's create response, if present. */
export function extractPermalink(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const b = body as { permalink?: unknown; url?: unknown; data?: { permalink?: unknown; url?: unknown } }
  const candidates = [b.permalink, b.url, b.data?.permalink, b.data?.url]
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c
  }
  return null
}

export interface PostClipOptions {
  videoPath: string
  /** Post body text (typically the AI social caption). */
  text: string
  /** Target space id. */
  spaceId: string
  /**
   * WorkVivo user id to attribute the post to. WorkVivo requires this (or a
   * user_external_id) to create an update, so an empty value will be rejected
   * by the API; omitted from the request when empty.
   */
  postAsUserId?: string
  signal?: AbortSignal
}

/** WorkVivo wants `created_at` as `YYYY-MM-DDTHH:MM:SSZ` (UTC, no milliseconds). */
function workvivoTimestamp(): string {
  return new Date().toISOString().slice(0, 19) + 'Z'
}

/** Post a rendered clip to a WorkVivo space as a feed update with the video attached. */
export async function postClipToSpace(
  config: WorkvivoRequestConfig,
  opts: PostClipOptions
): Promise<WorkvivoPostResult> {
  const bytes = await readFile(opts.videoPath)
  const form = new FormData()
  form.append(FIELD_TEXT, opts.text)
  form.append(FIELD_CREATED_AT, workvivoTimestamp())
  // Target the chosen space via the audience array (audience[spaces][0]).
  form.append(FIELD_AUDIENCE_TYPE, AUDIENCE_TYPE_SPACES)
  form.append(fieldAudienceSpace(0), opts.spaceId)
  if (opts.postAsUserId) form.append(FIELD_USER_ID, opts.postAsUserId)
  form.append(
    FIELD_VIDEO,
    new Blob([new Uint8Array(bytes)], { type: 'video/mp4' }),
    basename(opts.videoPath)
  )

  const res = await fetch(`${config.apiBase}/${UPDATES_ENDPOINT}`, {
    method: 'POST',
    // Content-Type (with multipart boundary) is set by fetch from the FormData.
    headers: authHeaders(config),
    body: form,
    signal: opts.signal
  })
  if (!res.ok) await raiseForStatus(res, 'Posting to WorkVivo')
  const body = (await res.json().catch(() => ({}))) as unknown
  return { ok: true, permalink: extractPermalink(body) }
}
