import { afterEach, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const mock = vi.hoisted(() => ({ root: '', spawn: vi.fn() }))
vi.mock('electron', () => ({ app: {
  getPath: () => mock.root, getAppPath: () => mock.root, isPackaged: false,
  once: vi.fn(), removeListener: vi.fn()
} }))
vi.mock('node:child_process', () => ({ spawn: mock.spawn }))
import { installLocalWhisper, localWhisperPaths } from '../src/main/localWhisper'

afterEach(async () => {
  mock.spawn.mockReset()
  if (mock.root) await rm(mock.root, { recursive: true, force: true })
  mock.root = ''
})

it('keeps Python and model downloads inside app data on each platform', () => {
  expect(localWhisperPaths('/app-data', 'darwin')).toEqual({
    environment: join('/app-data', 'local-whisper', 'venv'),
    python: join('/app-data', 'local-whisper', 'venv', 'bin', 'python'),
    models: join('/app-data', 'local-whisper', 'models')
  })
  expect(localWhisperPaths('/app-data', 'win32').python).toBe(join('/app-data', 'local-whisper', 'venv', 'Scripts', 'python.exe'))
})

function fakePlatform(platform: string, arch: string): () => void {
  const saved = { platform: process.platform, arch: process.arch }
  Object.defineProperty(process, 'platform', { value: platform })
  Object.defineProperty(process, 'arch', { value: arch })
  return () => {
    Object.defineProperty(process, 'platform', { value: saved.platform })
    Object.defineProperty(process, 'arch', { value: saved.arch })
  }
}

function succeedUnless(failing?: (args: string[]) => boolean): void {
  mock.spawn.mockImplementation((_command: string, args: string[]) => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn()
    })
    setTimeout(() => child.emit('close', failing?.(args) ? 1 : 0), 0)
    return child
  })
}

const downloadCall = (): string[] => mock.spawn.mock.calls.map(c => c[1] as string[]).find(a => a.some(x => x.endsWith('install.py')))!

it('creates a private environment and downloads only the selected model', async () => {
  const restore = fakePlatform('linux', 'x64')
  try {
    mock.root = await mkdtemp(join(tmpdir(), 'cutawan-whisper-test-'))
    succeedUnless()
    const progress = vi.fn()
    const result = await installLocalWhisper('small', 'python3', progress)
    const paths = localWhisperPaths(mock.root)
    expect(result).toEqual({
      pythonPath: paths.python,
      modelPath: join(paths.models, 'small')
    })
    expect(mock.spawn).toHaveBeenCalledTimes(4)
    expect(mock.spawn).toHaveBeenNthCalledWith(1, 'python3', ['-m', 'venv', paths.environment],
      expect.objectContaining({ shell: false }))
    expect(downloadCall()).toContain('small')
    expect(downloadCall()).not.toContain('--mlx')
    expect(progress).toHaveBeenCalledWith({ progress: 1, message: 'Local Whisper is ready.' })
  } finally { restore() }
})

it('adds GPU transcription on Apple Silicon, and still installs when it is unavailable', async () => {
  const restore = fakePlatform('darwin', 'arm64')
  try {
    mock.root = await mkdtemp(join(tmpdir(), 'cutawan-whisper-test-'))
    succeedUnless()
    await installLocalWhisper('small', 'python3', vi.fn())
    expect(mock.spawn.mock.calls.some(c => (c[1] as string[]).includes('mlx-whisper'))).toBe(true)
    expect(downloadCall()).toContain('--mlx')

    mock.spawn.mockReset()
    succeedUnless(args => args.includes('mlx-whisper'))
    const result = await installLocalWhisper('small', 'python3', vi.fn())
    expect(result.modelPath).toContain('small')
    expect(downloadCall()).not.toContain('--mlx')
  } finally { restore() }
})
