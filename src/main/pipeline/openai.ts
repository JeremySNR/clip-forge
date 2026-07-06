import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

/**
 * Minimal OpenAI REST client using Node's built-in fetch, so the app has no
 * SDK dependency. Only the two endpoints the pipeline needs are wrapped.
 * All calls retry transient failures with exponential backoff and support
 * cancellation via AbortSignal.
 */

const API_BASE = process.env.OPENAI_BASE_URL?.replace(/\/$/, '') ?? 'https://api.openai.com/v1'

export class OpenAIError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message)
    this.name = 'OpenAIError'
  }
}

/** Client errors that retrying cannot fix (bad key, bad request, not found). */
function isNonRetryable(err: unknown): boolean {
  return (
    err instanceof OpenAIError &&
    err.status !== undefined &&
    err.status >= 400 &&
    err.status < 500 &&
    err.status !== 408 &&
    err.status !== 429
  )
}

export interface RetryOptions {
  attempts?: number
  baseDelayMs?: number
  signal?: AbortSignal
}

/** Run `fn` with exponential backoff on transient failures. */
export async function withRetries<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 4
  const baseDelayMs = opts.baseDelayMs ?? 1500
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    opts.signal?.throwIfAborted()
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (opts.signal?.aborted || isNonRetryable(err)) throw err
      if (attempt < attempts - 1) {
        const jitter = Math.random() * 0.3 + 0.85
        await sleep(baseDelayMs * 2 ** attempt * jitter, undefined, { signal: opts.signal })
      }
    }
  }
  throw lastError
}

async function raiseForStatus(res: Response, context: string): Promise<void> {
  if (res.ok) return
  let detail = ''
  try {
    const body = (await res.json()) as { error?: { message?: string } }
    detail = body.error?.message ?? ''
  } catch {
    /* non-JSON error body */
  }
  if (res.status === 401) {
    throw new OpenAIError('OpenAI rejected the API key. Check it in Settings.', 401)
  }
  throw new OpenAIError(`${context} failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}`, res.status)
}

export interface WhisperWord {
  word: string
  start: number
  end: number
}

export interface WhisperSegment {
  id: number
  text: string
  start: number
  end: number
}

export interface WhisperResponse {
  language: string
  duration: number
  text: string
  words?: WhisperWord[]
  segments?: WhisperSegment[]
}

export interface TranscribeFileOptions {
  /** Trailing text of the previous chunk, for cross-chunk context continuity. */
  contextPrompt?: string
  /**
   * ISO-639-1 language code (e.g. 'en'). When set, Whisper transcribes in that
   * language instead of auto-detecting — which avoids it occasionally guessing
   * the wrong language. Omit or pass 'auto' to let Whisper detect.
   */
  language?: string
  signal?: AbortSignal
}

export async function transcribeAudioFile(
  apiKey: string,
  filePath: string,
  model: string,
  opts: TranscribeFileOptions = {}
): Promise<WhisperResponse> {
  const bytes = await readFile(filePath)
  return withRetries(
    async () => {
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(bytes)], { type: 'audio/mpeg' }), basename(filePath))
      form.append('model', model)
      form.append('response_format', 'verbose_json')
      form.append('timestamp_granularities[]', 'word')
      form.append('timestamp_granularities[]', 'segment')
      if (opts.contextPrompt) form.append('prompt', opts.contextPrompt)
      if (opts.language && opts.language !== 'auto') form.append('language', opts.language)

      const res = await fetch(`${API_BASE}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: opts.signal
      })
      await raiseForStatus(res, 'Transcription')
      return (await res.json()) as WhisperResponse
    },
    { signal: opts.signal }
  )
}

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }

export interface ChatMessage {
  role: 'system' | 'user'
  content: string | ChatContentPart[]
}

export async function chatJSON<T>(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  schemaName: string,
  schema: Record<string, unknown>,
  signal?: AbortSignal
): Promise<T> {
  return withRetries(
    async () => {
      const res = await fetch(`${API_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages,
          response_format: {
            type: 'json_schema',
            json_schema: { name: schemaName, strict: true, schema }
          }
        }),
        signal
      })
      await raiseForStatus(res, 'Analysis')
      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const content = body.choices?.[0]?.message?.content
      if (!content) throw new OpenAIError('Analysis returned an empty response')
      try {
        return JSON.parse(content) as T
      } catch {
        throw new OpenAIError('Analysis returned invalid JSON')
      }
    },
    { signal }
  )
}
