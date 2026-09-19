import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DEFAULT_SUBSCRIPTION, normalizeSubscription } from '../src/shared/subscription'

const mock = vi.hoisted(() => ({ root: '', spawn: vi.fn(), login: 'Logged in using ChatGPT', fail: false }))
vi.mock('electron', () => ({ app: { getPath: () => mock.root, getAppPath: () => mock.root, isPackaged: false, once: vi.fn(), removeListener: vi.fn() } }))
vi.mock('node:child_process', () => ({ spawn: mock.spawn }))
import { configureSubscription, subscriptionJSON, subscriptionEnvironment, codexArguments, SubscriptionError } from '../src/main/subscription'

const messages = [{ role: 'user' as const, content: 'Pick a complete moment.' }]
const schema = { type: 'object', properties: { title: { type: 'string' } }, required: ['title'], additionalProperties: false }
beforeEach(async () => {
  mock.root = await mkdtemp(join(tmpdir(), 'clipforge-subscription-test-'))
  mock.login = 'Logged in using ChatGPT'
  mock.fail = false
  mock.spawn.mockReset().mockImplementation((_exe: string, args: string[]) => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), stdin: Object.assign(new EventEmitter(), { end: vi.fn() }), kill: vi.fn() })
    setTimeout(() => { void (async () => {
      if (args[0] === 'login') child.stderr.emit('data', mock.login)
      else if (!mock.fail) await writeFile(args[args.indexOf('--output-last-message') + 1], JSON.stringify({ title: 'A complete story' }))
      child.emit('close', args[0] !== 'login' && mock.fail ? 1 : 0)
    })() }, 0)
    return child
  })
  configureSubscription({ ...DEFAULT_SUBSCRIPTION, provider: 'chatgpt', dailyRequestLimit: 1 })
})
afterEach(async () => { await rm(mock.root, { recursive: true, force: true }); configureSubscription(DEFAULT_SUBSCRIPTION) })

it('keeps legacy settings on API and normalizes request limits', () => {
  expect(normalizeSubscription().provider).toBe('api')
  expect(normalizeSubscription({ dailyRequestLimit: -1 }).dailyRequestLimit).toBe(0)
  expect(normalizeSubscription({ dailyRequestLimit: NaN }).dailyRequestLimit).toBe(10)
})
it('pins the requested model and low reasoning and removes API billing credentials', () => {
  const args = codexArguments('gpt-5.6-luna', '/job', [])
  expect(args).toContain('gpt-5.6-luna')
  expect(args).toContain('forced_login_method="chatgpt"')
  expect(args).toContain('model_reasoning_effort="low"')
  expect(subscriptionEnvironment({ OPENAI_API_KEY: 'secret', CODEX_API_KEY: 'secret', CODEX_ACCESS_TOKEN: 'secret', PATH: '/bin' })).toEqual({ PATH: '/bin' })
})
it('reuses cached analysis with cap zero without invoking Codex again', async () => {
  const first = await subscriptionJSON(messages, schema)
  configureSubscription({ ...DEFAULT_SUBSCRIPTION, provider: 'chatgpt', dailyRequestLimit: 0 })
  expect(await subscriptionJSON(messages, schema)).toEqual(first)
  expect(mock.spawn).toHaveBeenCalledTimes(2) // login status + one inference
})
it('serializes concurrent requests so they cannot overspend the cap', async () => {
  const results = await Promise.allSettled([
    subscriptionJSON(messages, schema),
    subscriptionJSON([{ role: 'user', content: 'Another moment' }], schema)
  ])
  expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected'])
  expect(mock.spawn).toHaveBeenCalledTimes(2)
  expect(JSON.parse(await readFile(join(mock.root, 'subscription-usage.json'), 'utf8')).requests).toBe(1)
})
it('rejects API-key login before inference and without reserving usage', async () => {
  mock.login = 'Logged in using an API key'
  await expect(subscriptionJSON(messages, schema)).rejects.toThrow('Sign in to Codex with ChatGPT')
  expect(mock.spawn).toHaveBeenCalledTimes(1)
})
it('counts failed inference and never silently retries or falls back', async () => {
  mock.fail = true
  await expect(subscriptionJSON(messages, schema)).rejects.toBeInstanceOf(SubscriptionError)
  await expect(subscriptionJSON(messages, schema)).rejects.toThrow('request cap reached')
  expect(mock.spawn).toHaveBeenCalledTimes(2)
})
it('does not reuse another model’s cached output', async () => {
  await subscriptionJSON(messages, schema)
  configureSubscription({ ...DEFAULT_SUBSCRIPTION, provider: 'chatgpt', codexModel: 'another-model', dailyRequestLimit: 1 })
  await expect(subscriptionJSON(messages, schema)).rejects.toThrow('request cap reached')
})
it('does not make any requests after cancellation', async () => {
  await expect(subscriptionJSON(messages, schema, AbortSignal.abort())).rejects.toBeInstanceOf(SubscriptionError)
  expect(mock.spawn).not.toHaveBeenCalled()
})

it('fails closed when another process holds the usage reservation', async () => {
  await writeFile(join(mock.root, 'subscription-usage.lock'), '')
  await expect(subscriptionJSON(messages, schema)).rejects.toThrow('Could not reserve ChatGPT usage')
  expect(mock.spawn).toHaveBeenCalledTimes(1) // authentication only
})

it('does not reset a damaged usage ledger and spend again', async () => {
  await writeFile(join(mock.root, 'subscription-usage.json'), '{"requests":-1}')
  await expect(subscriptionJSON(messages, schema)).rejects.toThrow('usage record is invalid')
  expect(mock.spawn).not.toHaveBeenCalled()
})

it('routes analysis to Codex without calling the REST API', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  try {
    const { chatJSON } = await import('../src/main/pipeline/openai')
    expect(await chatJSON('unused-key', 'ignored-api-model', messages, 'test', schema)).toEqual({ title: 'A complete story' })
    expect(fetch).not.toHaveBeenCalled()
  } finally { fetch.mockRestore() }
})

it('stops a running inference on cancellation, including its Windows process tree', async () => {
  let active: EventEmitter | undefined
  const controller = new AbortController()
  mock.spawn.mockImplementation((exe: string, args: string[]) => {
    const child = Object.assign(new EventEmitter(), {
      pid: 1357911, stdout: new EventEmitter(), stderr: new EventEmitter(),
      stdin: Object.assign(new EventEmitter(), { end: vi.fn() }),
      kill: () => { setTimeout(() => child.emit('close', 1), 0); return true }
    })
    if (exe === 'taskkill.exe') setTimeout(() => { active?.emit('close', 1); child.emit('close', 0) }, 0)
    else if (args[0] === 'login') setTimeout(() => { child.stderr.emit('data', mock.login); child.emit('close', 0) }, 0)
    else { active = child; setTimeout(() => controller.abort(), 0) }
    return child
  })
  const kill = vi.spyOn(process, 'kill').mockImplementation(() => { setTimeout(() => active?.emit('close', 1), 0); return true })
  try {
    await expect(subscriptionJSON(messages, schema, controller.signal)).rejects.toThrow('cancelled or timed out')
    if (process.platform === 'win32') expect(mock.spawn).toHaveBeenCalledWith('taskkill.exe', ['/PID', '1357911', '/T', '/F'], expect.objectContaining({ windowsHide: true, shell: false }))
    else expect(kill).toHaveBeenCalledWith(-1357911, 'SIGTERM')
  } finally { kill.mockRestore() }
})
