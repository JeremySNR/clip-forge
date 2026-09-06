import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_OPENAI_API_BASE,
  chatApiBase,
  chatJSON,
  configureOpenAiEndpoints,
  extractJsonText,
  resolveOpenAiApiBase,
  transcriptionApiBase
} from '../src/main/pipeline/openai'

describe('resolveOpenAiApiBase', () => {
  it('defaults when unset, empty, or whitespace', () => {
    expect(resolveOpenAiApiBase(undefined)).toBe(DEFAULT_OPENAI_API_BASE)
    expect(resolveOpenAiApiBase('')).toBe(DEFAULT_OPENAI_API_BASE)
    expect(resolveOpenAiApiBase('   ')).toBe(DEFAULT_OPENAI_API_BASE)
  })

  it('rejects relative paths that make fetch post to /v1/audio/transcriptions', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(resolveOpenAiApiBase('/v1')).toBe(DEFAULT_OPENAI_API_BASE)
    expect(resolveOpenAiApiBase('v1')).toBe(DEFAULT_OPENAI_API_BASE)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('normalizes the bare OpenAI host to include /v1', () => {
    expect(resolveOpenAiApiBase('https://api.openai.com')).toBe('https://api.openai.com/v1')
    expect(resolveOpenAiApiBase('https://api.openai.com/')).toBe('https://api.openai.com/v1')
  })

  it('keeps explicit /v1 bases and third-party proxies unchanged', () => {
    expect(resolveOpenAiApiBase('https://api.openai.com/v1')).toBe('https://api.openai.com/v1')
    expect(resolveOpenAiApiBase('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1')
    expect(resolveOpenAiApiBase('https://openrouter.ai/api/v1')).toBe('https://openrouter.ai/api/v1')
    expect(resolveOpenAiApiBase('https://proxy.example.com/v1')).toBe('https://proxy.example.com/v1')
  })
})

describe('configureOpenAiEndpoints', () => {
  const envBase = process.env.OPENAI_BASE_URL
  const envTranscribe = process.env.OPENAI_TRANSCRIPTION_BASE_URL

  afterEach(() => {
    configureOpenAiEndpoints({})
    if (envBase === undefined) delete process.env.OPENAI_BASE_URL
    else process.env.OPENAI_BASE_URL = envBase
    if (envTranscribe === undefined) delete process.env.OPENAI_TRANSCRIPTION_BASE_URL
    else process.env.OPENAI_TRANSCRIPTION_BASE_URL = envTranscribe
  })

  it('uses Settings when env is unset', () => {
    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_TRANSCRIPTION_BASE_URL
    configureOpenAiEndpoints({ chatBase: 'https://openrouter.ai/api/v1' })
    expect(chatApiBase()).toBe('https://openrouter.ai/api/v1')
    expect(transcriptionApiBase()).toBe('https://openrouter.ai/api/v1')
  })

  it('lets transcription use a local Whisper server beside a hosted LLM', () => {
    delete process.env.OPENAI_BASE_URL
    delete process.env.OPENAI_TRANSCRIPTION_BASE_URL
    configureOpenAiEndpoints({
      chatBase: 'https://openrouter.ai/api/v1',
      transcriptionBase: 'http://127.0.0.1:8080/v1'
    })
    expect(chatApiBase()).toBe('https://openrouter.ai/api/v1')
    expect(transcriptionApiBase()).toBe('http://127.0.0.1:8080/v1')
  })

  it('lets OPENAI_BASE_URL override Settings', () => {
    process.env.OPENAI_BASE_URL = 'https://proxy.example.com/v1'
    configureOpenAiEndpoints({ chatBase: 'https://openrouter.ai/api/v1' })
    expect(chatApiBase()).toBe('https://proxy.example.com/v1')
    expect(transcriptionApiBase()).toBe('https://proxy.example.com/v1')
  })
})

describe('extractJsonText', () => {
  it('unwraps markdown fences some local models add', () => {
    expect(extractJsonText('```json\n{"a":1}\n```')).toBe('{"a":1}')
    expect(extractJsonText('{"a":1}')).toBe('{"a":1}')
  })
})

describe('chatJSON', () => {
  const envBase = process.env.OPENAI_BASE_URL

  afterEach(() => {
    vi.unstubAllGlobals()
    configureOpenAiEndpoints({})
    if (envBase === undefined) delete process.env.OPENAI_BASE_URL
    else process.env.OPENAI_BASE_URL = envBase
  })

  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['ok'],
    properties: { ok: { type: 'boolean' } }
  }

  it('falls back from json_schema to json_object when the provider rejects the format', async () => {
    delete process.env.OPENAI_BASE_URL
    configureOpenAiEndpoints({ chatBase: 'http://127.0.0.1:11434/v1' })
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { response_format?: { type?: string } }
      if (body.response_format?.type === 'json_schema') {
        return new Response(JSON.stringify({ error: { message: 'response_format json_schema is not supported' } }), {
          status: 400
        })
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), {
        status: 200
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await chatJSON<{ ok: boolean }>(
      'sk-test',
      'local-model',
      [{ role: 'user', content: 'hi' }],
      'test',
      schema
    )
    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const first = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      response_format?: { type?: string }
    }
    const second = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      response_format?: { type?: string }
    }
    expect(first.response_format?.type).toBe('json_schema')
    expect(second.response_format?.type).toBe('json_object')
  })

  it('does not fall back on a real 401', async () => {
    delete process.env.OPENAI_BASE_URL
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      chatJSON('sk-bad', 'gpt', [{ role: 'user', content: 'hi' }], 'test', schema)
    ).rejects.toThrow(/rejected the API key/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
