import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

/**
 * Minimal OpenAI REST client using Node's built-in fetch, so the app has no
 * SDK dependency. Only the two endpoints the pipeline needs are wrapped.
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

export async function transcribeAudioFile(
  apiKey: string,
  filePath: string,
  model: string
): Promise<WhisperResponse> {
  const bytes = await readFile(filePath)
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(bytes)], { type: 'audio/mpeg' }), basename(filePath))
  form.append('model', model)
  form.append('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'word')
  form.append('timestamp_granularities[]', 'segment')

  const res = await fetch(`${API_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  })
  await raiseForStatus(res, 'Transcription')
  return (await res.json()) as WhisperResponse
}

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

export async function chatJSON<T>(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  schemaName: string,
  schema: Record<string, unknown>
): Promise<T> {
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
    })
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
}
