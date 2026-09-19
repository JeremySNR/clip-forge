import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { runFfmpeg } from '../src/main/pipeline/ffmpeg'

const exec = promisify(execFile)
let dir: string
const cli = (...args: string[]) => exec(process.execPath,
  ['node_modules/tsx/dist/cli.mjs', '--tsconfig', 'tsconfig.node.json', 'scripts/quality-benchmark.ts', ...args],
  { cwd: process.cwd() })

describe('offline quality experiment', () => {
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cutawan-benchmark-'))
    await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=blue:s=160x90:d=1:r=10',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(dir, 'source.mp4')])
  })
  afterAll(async () => {
    if (dirname(resolve(dir)) !== resolve(tmpdir())) throw new Error('Unexpected test cleanup path')
    await rm(dir, { recursive: true, force: true })
  })

  it('checks media, evaluates predictions and prepares anonymously named playable copies', async () => {
    const media = await readFile(join(dir, 'source.mp4'))
    const reference = { sourceSha256: createHash('sha256').update(media).digest('hex'), durationSec: 1,
      words: [{ text: 'hello', start: 0.1, end: 0.5 }], highlights: [{ start: 0, end: 1 }] }
    await writeFile(join(dir, 'reference.json'), JSON.stringify(reference))
    await writeFile(join(dir, 'predictions.json'), JSON.stringify({ schemaVersion: 1,
      provenance: { system: 'Synthetic test only', revision: 'fixture', configuration: 'No model measured' },
      cases: { demo: reference }, renders: [{ caseId: 'demo', path: 'source.mp4' }] }))
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ schemaVersion: 1,
      cases: [{ id: 'demo', split: 'test', tags: ['synthetic'], reference: 'reference.json', source: 'source.mp4' }],
      runs: [{ id: 'fixture-system', predictions: 'predictions.json' }] }))
    const output = join(dir, 'experiment')
    await cli('compare', join(dir, 'manifest.json'), output)
    const report = JSON.parse(await readFile(join(output, 'metrics.json'), 'utf8'))
    expect(report.results[0].cases[0].metrics.words.wordErrorRate).toBe(0)
    expect(report.results[0].cases[0].metrics.speakers).toBeNull()
    const key = JSON.parse(await readFile(join(output, 'private-key.json'), 'utf8'))
    expect(key[0].runId).toBe('fixture-system')
    expect(await readFile(join(output, `${key[0].id}.mp4`))).toEqual(media)
    const html = await readFile(join(output, 'review.html'), 'utf8')
    expect(html).toContain('Download ratings')
    expect(html).not.toContain('fixture-system')
    await expect(cli('compare', join(dir, 'manifest.json'), output)).rejects.toThrow()
  }, 30_000)

  it('exports stored transcript and clip decisions without inventing speaker labels', async () => {
    const projectPath = join(dir, 'project.json')
    await writeFile(projectPath, JSON.stringify({ video: { path: join(dir, 'source.mp4'), durationSec: 1 },
      transcript: { segments: [{ words: [{ text: '', sourceText: 'hello', start: 0.1, end: 0.5 }] }] },
      clips: [{ viralityScore: 80, edit: { start: 0, end: 1 } }] }))
    const output = join(dir, 'exported.json')
    await cli('export-project', projectPath, 'demo', output)
    const run = JSON.parse(await readFile(output, 'utf8'))
    expect(run.cases.demo.words[0].text).toBe('hello')
    expect(run.cases.demo.speakers).toBeUndefined()
    expect(run.cases.demo.highlights).toEqual([{ start: 0, end: 1 }])
  }, 30_000)
})
