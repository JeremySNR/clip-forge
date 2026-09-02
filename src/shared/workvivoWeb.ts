/**
 * Request shapes for WorkVivo's *web* upload flow, as used by the browser app.
 *
 * Why this exists alongside the documented Customer API (`pipeline/workvivo`):
 * the Customer API accepts a video only as an inline multipart field, and the
 * infrastructure in front of it rejects bodies somewhere around 10-17MB with
 * HTTP 413. The web app never sends video through the API at all. It asks the
 * tenant for presigned S3 credentials, uploads straight to S3, and then names
 * the uploaded object when creating the post. A 459MB upload was observed
 * going through that path without complaint.
 *
 * This is an internal, undocumented endpoint set. It can change without
 * notice, so everything here is derived from an observed exchange and kept in
 * one place where it is easy to re-check.
 *
 * Three steps:
 *   1. POST /api/s3/signature/generate?extension=&cacheBust=&duration=
 *   2. POST <s3 action>            multipart, the returned inputs then `file`
 *   3. POST /api/posts             JSON naming the object, size and signatures
 */

/** Response of step 1. Field names are WorkVivo's, not ours. */
export interface WorkvivoS3Signature {
  mimeType: string
  attributes: {
    /** S3 bucket endpoint the form posts to. */
    action: string
    method: string
    enctype: string
  }
  /** Form fields that must be sent, in order, before the file part. */
  inputs: Record<string, string>
  /** CloudFront URL the finished object will be readable from. */
  signedUrl?: string
  /** WorkVivo's own signature over the object key, replayed in step 3. */
  wvSignature: string
}

export interface WorkvivoWebVideo {
  /** S3 object key, i.e. `inputs.key` from step 1. */
  path: string
  /** Size of the uploaded file in bytes. */
  size: number
  mime: string
  wvSignature: string
  /** `inputs['X-Amz-Signature']` from step 1, replayed verbatim. */
  amzSignature: string
}

export class WorkvivoWebError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    /** True when the session is missing or expired and a re-login would help. */
    public readonly needsLogin = false
  ) {
    super(message)
    this.name = 'WorkvivoWebError'
  }
}

/** Normalise a tenant URL to a bare origin, e.g. `https://acme.workvivo.com`. */
export function webOrigin(url: string | undefined): string | null {
  const raw = url?.trim()
  if (!raw) return null
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const u = new URL(withScheme)
    if (!u.hostname.includes('.')) return null
    return `https://${u.hostname}`
  } catch {
    return null
  }
}

/**
 * Step 1 URL. `cacheBust` mirrors what the web app sends; it exists to defeat
 * intermediate caches, so any random value will do. Passed in rather than
 * generated here so the function stays pure and testable.
 */
export function signatureUrl(
  origin: string,
  opts: { extension: string; durationSec: number; cacheBust: string }
): string {
  const q = new URLSearchParams({
    extension: opts.extension,
    cacheBust: opts.cacheBust,
    // The web app sends whole seconds.
    duration: String(Math.max(0, Math.round(opts.durationSec)))
  })
  return `${origin}/api/s3/signature/generate?${q.toString()}`
}

/** CSRF token endpoint; returns `{ token }`. */
export function refreshUrl(origin: string): string {
  return `${origin}/refresh`
}

export function postsUrl(origin: string): string {
  return `${origin}/api/posts`
}

/**
 * Pull the video descriptor for step 3 out of the step 1 response plus the
 * size actually uploaded. Every value is replayed from the signature exactly
 * as issued; nothing here is recomputed.
 */
export function videoFromSignature(
  signature: WorkvivoS3Signature,
  sizeBytes: number
): WorkvivoWebVideo {
  const path = signature.inputs?.key
  const amzSignature = signature.inputs?.['X-Amz-Signature']
  if (!path || !amzSignature || !signature.wvSignature) {
    throw new WorkvivoWebError(
      'WorkVivo returned an upload signature in an unexpected shape. The internal upload API may have changed.'
    )
  }
  return {
    path,
    size: sizeBytes,
    mime: signature.mimeType || 'video/mp4',
    wvSignature: signature.wvSignature,
    amzSignature
  }
}

/**
 * Body for step 3. Mirrors the browser's payload field for field: the endpoint
 * is undocumented, so sending the same shape it already accepts is safer than
 * sending only what looks necessary.
 */
export function buildPostBody(opts: {
  text: string
  spaceId: string
  video: WorkvivoWebVideo
}): Record<string, unknown> {
  const spaceId = Number(opts.spaceId)
  return {
    text: opts.text,
    audience: {
      type: 'spaces',
      // The web app uses numeric ids; fall back to the raw string if a space
      // id ever arrives non-numeric so the request still carries something.
      spaces: [{ id: Number.isFinite(spaceId) ? spaceId : opts.spaceId }],
      teams: []
    },
    kudos_recipients: [],
    goal: null,
    images: [],
    video: opts.video,
    link: null,
    poll: null,
    attachments: [],
    publish_at: null,
    social_sharing: { enabled: false, default_text: '', everyonesocial_link: '' },
    acknowledgement: { enabled: false, button_labels_key: null },
    draft_post: { status: 'publish', item: {} },
    campaigns: null,
    classifications: [],
    disable_comments: false,
    videoUploadProgress: 100
  }
}

/** Post id from the step 3 response, or null if the shape is unfamiliar. */
export function postIdFromResponse(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const data = (body as { data?: { id?: unknown } }).data
  const id = data?.id
  return typeof id === 'number' || typeof id === 'string' ? String(id) : null
}

/** Permalink to a created post. */
export function postPermalink(origin: string, postId: string): string {
  return `${origin}/posts/${postId}`
}
