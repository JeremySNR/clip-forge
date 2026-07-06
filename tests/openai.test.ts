import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_OPENAI_API_BASE, resolveOpenAiApiBase } from '../src/main/pipeline/openai'

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
