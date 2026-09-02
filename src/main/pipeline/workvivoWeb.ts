import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { request as httpsRequest } from 'node:https'

import {
  buildPostBody,
  postIdFromResponse,
  postPermalink,
  postsUrl,
  signatureUrl,
  videoFromSignature,
  WorkvivoWebError,
  type WorkvivoS3Signature
} from '@shared/workvivoWeb'
import {
  getWorkvivoWebAuth,
  webAuthHeaders,
  workvivoSession,
  type WorkvivoWebAuth
} from '../workvivoSession'

/**
 * WorkVivo's web upload path: presigned S3 credentials, a direct upload to the
 * bucket, then a post that names the uploaded object. See `@shared/workvivoWeb`
 * for why this exists next to the documented Customer API.
 */

/** Step 1: ask the tenant for presigned S3 credentials. */
async function generateSignature(
  auth: WorkvivoWebAuth,
  opts: { extension: string; durationSec: number }
): Promise<WorkvivoS3Signature> {
  const url = signatureUrl(auth.origin, {
    extension: opts.extension,
    durationSec: opts.durationSec,
    cacheBust: String(Math.random())
  })
  const res = await workvivoSession().fetch(url, {
    method: 'POST',
    headers: webAuthHeaders(auth)
  })
  if (res.status === 401 || res.status === 419) {
    throw new WorkvivoWebError(
      'Your WorkVivo session has expired. Sign in again from Settings.',
      res.status,
      true
    )
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new WorkvivoWebError(
      `WorkVivo would not issue an upload signature (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}.`,
      res.status
    )
  }
  const body = (await res.json()) as WorkvivoS3Signature
  if (!body?.attributes?.action || !body?.inputs) {
    throw new WorkvivoWebError(
      'WorkVivo returned an upload signature in an unexpected shape. The internal upload API may have changed.'
    )
  }
  return body
}

/** One multipart field, as bytes. */
function fieldPart(boundary: string, name: string, value: string): Buffer {
  return Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    'utf8'
  )
}

/**
 * Step 2: upload straight to S3.
 *
 * Streamed rather than buffered, and sent with an explicit Content-Length:
 * these files run to hundreds of megabytes, and an S3 presigned POST rejects
 * chunked transfer encoding, which is what `fetch` would use for a stream
 * body. So the multipart envelope is assembled by hand around a file stream.
 */
async function uploadToS3(
  signature: WorkvivoS3Signature,
  filePath: string,
  opts: { signal?: AbortSignal; onProgress?: (fraction: number) => void }
): Promise<number> {
  const { size } = await stat(filePath)
  const boundary = `----ClipForgeBoundary${randomUUID().replace(/-/g, '')}`

  // S3 requires every policy field before the file part.
  const preamble = Buffer.concat(
    Object.entries(signature.inputs).map(([k, v]) => fieldPart(boundary, k, String(v)))
  )
  const fileHeader = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${basename(filePath)}"\r\n` +
      `Content-Type: ${signature.mimeType || 'video/mp4'}\r\n\r\n`,
    'utf8'
  )
  const trailer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
  const contentLength = preamble.length + fileHeader.length + size + trailer.length

  const action = new URL(signature.attributes.action)

  await new Promise<void>((resolve, reject) => {
    const req = httpsRequest(
      {
        method: signature.attributes.method || 'POST',
        hostname: action.hostname,
        path: action.pathname === '/' ? '/' : action.pathname,
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': contentLength
        }
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const status = res.statusCode ?? 0
          if (status >= 200 && status < 300) {
            resolve()
            return
          }
          // S3 explains refusals in an XML body; keep it, it names the field.
          const body = Buffer.concat(chunks).toString('utf8').replace(/\s+/g, ' ').trim()
          reject(
            new WorkvivoWebError(
              `The video upload to S3 failed (HTTP ${status})${body ? `: ${body.slice(0, 300)}` : ''}.`,
              status
            )
          )
        })
      }
    )

    const onAbort = (): void => {
      req.destroy(new WorkvivoWebError('Upload cancelled.'))
    }
    if (opts.signal) {
      if (opts.signal.aborted) return onAbort()
      opts.signal.addEventListener('abort', onAbort, { once: true })
    }

    req.on('error', reject)
    req.write(preamble)
    req.write(fileHeader)

    let sent = 0
    const file = createReadStream(filePath)
    file.on('data', (chunk) => {
      sent += chunk.length
      opts.onProgress?.(Math.min(1, sent / Math.max(1, size)))
    })
    file.on('error', reject)
    file.on('end', () => {
      req.end(trailer)
    })
    file.pipe(req, { end: false })
  })

  return size
}

/** Step 3: create the feed post naming the uploaded object. */
async function createPost(
  auth: WorkvivoWebAuth,
  body: Record<string, unknown>
): Promise<{ permalink: string | null }> {
  const res = await workvivoSession().fetch(postsUrl(auth.origin), {
    method: 'POST',
    headers: { ...webAuthHeaders(auth), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (res.status === 401 || res.status === 419) {
    throw new WorkvivoWebError(
      'Your WorkVivo session expired while posting. Sign in again from Settings.',
      res.status,
      true
    )
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new WorkvivoWebError(
      `WorkVivo rejected the post (HTTP ${res.status})${detail ? `: ${detail.slice(0, 300)}` : ''}.`,
      res.status
    )
  }
  const json = (await res.json().catch(() => ({}))) as unknown
  const id = postIdFromResponse(json)
  return { permalink: id ? postPermalink(auth.origin, id) : null }
}

export interface WebPostOptions {
  /** Tenant WorkVivo URL, e.g. https://acme.workvivo.com. */
  url: string | undefined
  videoPath: string
  /** Duration in seconds; the signature endpoint expects it. */
  durationSec: number
  text: string
  spaceId: string
  signal?: AbortSignal
  /** Upload progress, 0..1. Rendering is reported by the caller. */
  onProgress?: (fraction: number, message: string) => void
}

/**
 * Post a rendered clip through the web flow. No size targeting: this path
 * uploads to S3 directly, so the clip goes up at full export quality.
 */
export async function postClipViaWeb(opts: WebPostOptions): Promise<{ permalink: string | null }> {
  const auth = await getWorkvivoWebAuth(opts.url)

  opts.onProgress?.(0, 'Preparing upload…')
  const extension = extname(opts.videoPath).replace('.', '').toLowerCase() || 'mp4'
  const signature = await generateSignature(auth, { extension, durationSec: opts.durationSec })

  const size = await uploadToS3(signature, opts.videoPath, {
    signal: opts.signal,
    onProgress: (f) => opts.onProgress?.(f, 'Uploading to WorkVivo…')
  })

  opts.onProgress?.(1, 'Publishing post…')
  return createPost(
    auth,
    buildPostBody({
      text: opts.text,
      spaceId: opts.spaceId,
      video: videoFromSignature(signature, size)
    })
  )
}
