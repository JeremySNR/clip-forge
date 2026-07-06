import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { WorkvivoPostResult, WorkvivoSpace, WorkvivoTestResult } from '@shared/types'

/**
 * Minimal WorkVivo Customer API client using Node's built-in fetch (no SDK).
 *
 * Auth model (confirmed against WorkVivo's docs and Zoom's own
 * `zoom/workvivo-zoom-integration`): every request carries a Bearer token plus
 * a `Workvivo-Id` header (the organisation id), against `<org-url>/api/v1`.
 * This is an org-level app token, not the user's interactive SSO login, so
 * posts are attributed to a configured identity (`user_id`) rather than
 * whoever clicks.
 *
 * Endpoints:
 * - `GET /spaces` — list spaces (used to power the picker + validate the
 *   connection). Confirmed shape: `{ data: [{ id, name }] }`.
 * - `POST /updates` — create a feed post targeted at a space, as
 *   `multipart/form-data` with `text`, `space_id`, an optional `user_id`, and a
 *   `video` file. The multipart video-upload pattern is confirmed from Zoom's
 *   integration (which uses the sibling `/kudos` endpoint the same way); the
 *   exact update-post endpoint/field names are centralised below so they are
 *   trivial to adjust against developer.workvivo.com if an org's tenant differs.
 */

/** Feed-post endpoint and its field names, kept in one place (see file header). */
const UPDATES_ENDPOINT = 'updates'
const FIELD_TEXT = 'text'
const FIELD_SPACE_ID = 'space_id'
const FIELD_USER_ID = 'user_id'
const FIELD_VIDEO = 'video'

export interface WorkvivoRequestConfig {
  /** Fully-qualified API base, e.g. https://acme.workvivo.com/api/v1. */
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
 * Derive the WorkVivo API base URL from an organisation's WorkVivo address.
 * Accepts `https://acme.workvivo.com`, a bare `acme.workvivo.us`, or a URL that
 * already includes a path — always returning `<origin>/api/v1`. Returns null
 * when the value is not a usable host. Exported for tests.
 */
export function deriveWorkvivoApiBase(url: string | undefined): string | null {
  const raw = url?.trim()
  if (!raw) return null
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const u = new URL(withScheme)
    if (!u.hostname.includes('.')) return null
    return `${u.origin}/api/v1`
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
      'WorkVivo denied the request — the token is missing the required scope (spaces:read / posting write).',
      403
    )
  }
  if (res.status === 404) {
    throw new WorkvivoError(
      `WorkVivo endpoint not found (HTTP 404). Check the WorkVivo URL and region (.com vs .us).`,
      404
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

/** List the spaces the token can post to (first page). */
export async function listSpaces(
  config: WorkvivoRequestConfig,
  signal?: AbortSignal
): Promise<WorkvivoSpace[]> {
  const res = await fetch(`${config.apiBase}/spaces?per_page=200`, {
    method: 'GET',
    headers: authHeaders(config),
    signal
  })
  if (!res.ok) await raiseForStatus(res, 'Listing WorkVivo spaces')
  const body = (await res.json()) as { data?: RawSpace[] }
  const spaces = (body.data ?? [])
    .map(toSpace)
    .filter((s): s is WorkvivoSpace => s !== null)
  spaces.sort((a, b) => a.name.localeCompare(b.name))
  return spaces
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
  /** WorkVivo user id to attribute the post to; omitted when empty. */
  postAsUserId?: string
  signal?: AbortSignal
}

/** Post a rendered clip to a WorkVivo space as a feed update with the video attached. */
export async function postClipToSpace(
  config: WorkvivoRequestConfig,
  opts: PostClipOptions
): Promise<WorkvivoPostResult> {
  const bytes = await readFile(opts.videoPath)
  const form = new FormData()
  form.append(FIELD_TEXT, opts.text)
  form.append(FIELD_SPACE_ID, opts.spaceId)
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
