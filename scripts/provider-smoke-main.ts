/** Live, explicitly invoked integration check. No provider responses are mocked. */
import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { configureSubscription } from '../src/main/subscription'
import { DEFAULT_SUBSCRIPTION } from '../src/shared/subscription'
import { configureOpenAiEndpoints, OpenAIError } from '../src/main/pipeline/openai'
import { probeVideo } from '../src/main/pipeline/ffmpeg'
import { rankEditorialCandidates } from '../src/main/pipeline/editorialReview'
import { discoverSourceMoments } from '../src/main/pipeline/sourceDiscovery'
import type { Clip, Transcript } from '../src/shared/types'

interface SmokeConfig {
  provider: 'api' | 'chatgpt'
  sourcePath: string
  sourceProvenance: string
  sourceAuthorizedForProvider: true
  model: string
  apiBaseUrl?: string
  codexPath?: string
  codexModel?: string
  /** Production profile used only by the real subscription cache and usage ledger. */
  subscriptionUserData?: string
  /** Supplied after checking settings; never persisted or raised by this runner. */
  subscriptionDailyLimit?: number
  maxRequests?: number
  /** Re-run through the real adapter with zero new allowance; uncached work fails closed. */
  cacheOnly?: boolean
  transcriptPath?: string
  clipStart?: number
  clipEnd?: number
  prompt?: string
}
interface Attempt { schema: string; imageCount: number; elapsedMs: number; status?: number; error?: string }

const output = process.env.CUTAWAN_PROVIDER_SMOKE_OUTPUT
const configPath = process.env.CUTAWAN_PROVIDER_SMOKE_CONFIG
if (!output || !configPath) throw new Error('Launch this helper through scripts/provider-smoke.mjs')
app.setName('Cutawan Provider Smoke')
app.setPath('userData', join(output, 'profile'))
const redact = (message: string): string => {
  let safe = message.replace(/(?:sk-|Bearer\s+)\S+/gi, '[redacted]')
  if (process.env.OPENAI_API_KEY) safe = safe.split(process.env.OPENAI_API_KEY).join('[redacted]')
  return safe.slice(0, 1600)
}
const write = (name: string, value: unknown): Promise<void> => writeFile(join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })

async function main(): Promise<void> {
  const config = JSON.parse(await readFile(configPath!, 'utf8')) as SmokeConfig
  if (!['api', 'chatgpt'].includes(config.provider) || !config.sourcePath || !config.model ||
    !config.sourceProvenance?.trim() || config.sourceAuthorizedForProvider !== true) {
    throw new Error('Configure a provider/model and explicitly authorized source with provenance')
  }
  const maxRequests = config.maxRequests ?? 4
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 4) throw new Error('Live smoke maxRequests must be 1–4')
  const summary: Record<string, unknown> = { schemaVersion: 1, startedAt: new Date().toISOString(), provider: config.provider,
    model: config.provider === 'chatgpt' ? config.codexModel ?? DEFAULT_SUBSCRIPTION.codexModel : config.model,
    sourceProvenance: config.sourceProvenance, maxRequests, cacheOnly: config.cacheOnly === true, isolatedLaunchProfile: true,
    interpretation: 'Provider/serialization/schema smoke only. No human quality, audience outcomes or competitive result measured.' }
  const key = process.env.OPENAI_API_KEY ?? ''
  if (config.provider === 'api' && !key) {
    await write('summary.json', { ...summary, status: 'blocked', reason: 'No OPENAI_API_KEY was supplied. No request made.' })
    console.log('API smoke blocked: no API credential supplied; no provider request made.')
    process.exitCode = 2; return
  }
  if (config.provider === 'api' && config.cacheOnly) throw new Error('cacheOnly is available for the ChatGPT adapter only')
  if (config.provider === 'chatgpt' && (!config.subscriptionUserData || !Number.isInteger(config.subscriptionDailyLimit) || config.subscriptionDailyLimit! < 1)) {
    await write('summary.json', { ...summary, status: 'blocked', reason: 'No verified remaining configured subscription budget was supplied. No request made.' })
    console.log('ChatGPT smoke blocked: verify the configured remaining request cap first.')
    process.exitCode = 2; return
  }
  const isolatedProfile = app.getPath('userData')
  await mkdir(isolatedProfile, { recursive: true })
  let startingRequests = 0
  if (config.provider === 'chatgpt') {
    const root = resolve(config.subscriptionUserData!)
    try {
      const usage = JSON.parse(await readFile(join(root, 'subscription-usage.json'), 'utf8')) as { date: string; requests: number }
      if (!Number.isSafeInteger(usage.requests) || usage.requests < 0) throw new Error('Invalid subscription usage ledger')
      startingRequests = usage.date === new Date().toISOString().slice(0, 10) ? usage.requests : 0
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (startingRequests >= config.subscriptionDailyLimit! && !config.cacheOnly) {
      await write('summary.json', { ...summary, status: 'blocked', reason: 'Configured daily subscription cap is exhausted. No request made.' })
      process.exitCode = 2; return
    }
    // No windows/settings are loaded. Only the subscription adapter accesses this profile.
    app.setPath('userData', root)
    summary.subscriptionUsage = { accounting: 'production cache and daily ledger', startingRequests,
      effectiveLimit: config.cacheOnly ? startingRequests : Math.min(config.subscriptionDailyLimit!, startingRequests + maxRequests) }
  }
  configureSubscription({ ...DEFAULT_SUBSCRIPTION, provider: config.provider,
    codexPath: config.codexPath ?? DEFAULT_SUBSCRIPTION.codexPath,
    codexModel: config.codexModel ?? DEFAULT_SUBSCRIPTION.codexModel,
    dailyRequestLimit: config.cacheOnly ? startingRequests : Math.min(config.subscriptionDailyLimit ?? maxRequests, startingRequests + maxRequests) })
  configureOpenAiEndpoints({ chatBase: config.apiBaseUrl })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('Live provider smoke exceeded ten minutes')), 10 * 60_000)
  const attempts: Attempt[] = [], nativeFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    if (config.provider !== 'api') throw new Error('API fallback is forbidden in ChatGPT smoke')
    if (attempts.length >= maxRequests) {
      controller.abort(new Error(`Live smoke request budget exhausted (${maxRequests})`))
      throw new OpenAIError('Live smoke request budget exhausted', 403)
    }
    const body = JSON.parse(String(init?.body ?? '{}')) as { response_format?: { json_schema?: { name?: string } }; messages?: Array<{ content?: unknown }> }
    const attempt: Attempt = { schema: body.response_format?.json_schema?.name ?? 'schema-fallback', elapsedMs: 0,
      imageCount: body.messages?.reduce((sum, message) => sum + (Array.isArray(message.content)
        ? message.content.filter(part => part?.type === 'image_url').length : 0), 0) ?? 0 }
    attempts.push(attempt)
    const start = Date.now()
    try {
      const response = await nativeFetch(input, init)
      attempt.status = response.status
      return response
    } catch (error) { attempt.error = redact(error instanceof Error ? error.message : String(error)); throw error }
    finally { attempt.elapsedMs = Date.now() - start }
  }
  try {
    const video = await probeVideo(resolve(config.sourcePath))
    if (video.durationSec <= 0 || video.durationSec > 45) throw new Error('Use a small authorized source of at most 45 seconds for this bounded smoke')
    const transcript: Transcript = config.transcriptPath
      ? JSON.parse(await readFile(resolve(config.transcriptPath), 'utf8')) as Transcript
      : { language: 'und', durationSec: video.durationSec, segments: [], speech: [] }
    const start = config.clipStart ?? 0, end = config.clipEnd ?? video.durationSec
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > video.durationSec || end - start < 3) throw new Error('Smoke candidate needs a valid interval of at least three seconds')
    const clip: Clip = { id: 'live-smoke-candidate', title: 'Fixed smoke interval', hook: '', summary: 'Provider smoke candidate, not a quality reference',
      suggestedStart: start, suggestedEnd: end, viralityScore: 0, viralityReason: 'Unscored controlled smoke input',
      visualSummary: null, hashtags: [], thumbnailPath: null, focusTrack: null, broll: [], reframeStatus: 'pending',
      edit: { start, end, aspect: '9:16', reframeMode: 'fit-letterbox', framing: 'manual', focusX: .5,
        tightenCuts: false, autoZoom: false, captionsEnabled: false, captionStyleId: 'beast', showTitle: false } }
    const providerCacheKey = config.provider === 'chatgpt' ? `chatgpt:${config.codexModel ?? DEFAULT_SUBSCRIPTION.codexModel}:low` : 'api:live-smoke'
    const stages: Record<string, unknown> = {}
    try {
      console.log(`Live ${config.provider} smoke: one fixed editorial candidate.`)
      const ranking = await rankEditorialCandidates({ video, transcript, sourceRevision: 0, clips: [clip], baselineClips: [clip],
        apiKey: key, model: config.model, providerCacheKey, prompt: config.prompt ?? '', signal: controller.signal })
      await write('editorial-report.json', ranking.report)
      stages.editorial = { status: 'completed', reviewed: ranking.report.reviewedCount, rejected: ranking.report.rejectedCount,
        needsReview: ranking.report.needsReviewCount, logicalCalls: ranking.report.reviewRequestCount,
        // Unsupported/missing/malformed responses use the fallback with no validated evidence.
        responseValidated: ranking.report.assessments.length === 1 && ranking.report.assessments[0].assessment.evidence.length > 0 }
    } catch (error) { stages.editorial = { status: 'failed', error: redact(error instanceof Error ? error.message : String(error)) } }
    try {
      console.log(`Live ${config.provider} smoke: full short-source discovery and any supported refinement.`)
      const discovery = await discoverSourceMoments({ videoPath: video.path, durationSec: video.durationSec, transcript,
        apiKey: key, model: config.model, providerCacheKey, prompt: config.prompt ?? '', maxClipDurationSec: 45,
        cacheDir: join(output!, 'discovery-cache'), signal: controller.signal })
      await write('discovery-report.json', discovery)
      stages.discovery = { status: discovery.status, candidates: discovery.candidates.length,
        successfulRefinements: discovery.successfulRefinementCount, failedRefinements: discovery.failedRefinementCount,
        logicalCalls: discovery.analysisRequestCount }
    } catch (error) { stages.discovery = { status: 'failed', error: redact(error instanceof Error ? error.message : String(error)) } }
    const editorial = stages.editorial as { status: string; needsReview?: number; responseValidated?: boolean }, discovery = stages.discovery as { status: string; successfulRefinements?: number }
    summary.status = editorial.status === 'completed' && editorial.responseValidated && discovery.status === 'complete'
      ? editorial.needsReview ? 'provider-smoke-passed-with-content-review' : 'provider-smoke-passed'
      : 'needs-investigation'
    summary.stages = stages
    summary.refinementExercised = (discovery.successfulRefinements ?? 0) > 0
    if (!String(summary.status).startsWith('provider-smoke-passed')) process.exitCode = 1
  } catch (error) { summary.status = 'failed'; summary.error = redact(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
  finally {
    clearTimeout(timeout)
    globalThis.fetch = nativeFetch
    summary.finishedAt = new Date().toISOString()
    if (config.provider === 'api') summary.networkAttempts = attempts
    else {
      try { summary.finalSubscriptionUsage = JSON.parse(await readFile(join(app.getPath('userData'), 'subscription-usage.json'), 'utf8')) }
      catch { summary.finalSubscriptionUsage = null }
    }
    app.setPath('userData', isolatedProfile)
    await write('summary.json', summary)
    console.log(`Live provider smoke finished: ${String(summary.status)}. See ${join(output!, 'summary.json')}`)
  }
}

void app.whenReady().then(main).catch(async error => {
  console.error(redact(error instanceof Error ? error.message : String(error)))
  process.exitCode = 1
}).finally(() => app.exit(Number(process.exitCode ?? 0)))
