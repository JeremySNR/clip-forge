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

it('creates a private environment and downloads only the selected model', async () => {
  mock.root = await mkdtemp(join(tmpdir(), 'cutawan-whisper-test-'))
  mock.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn()
    })
    setTimeout(() => child.emit('close', 0), 0)
    return child
  })
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
  expect(mock.spawn.mock.calls[2][1]).toContain('small')
  expect(progress).toHaveBeenCalledWith({ progress: 1, message: 'Local Whisper is ready.' })
})
