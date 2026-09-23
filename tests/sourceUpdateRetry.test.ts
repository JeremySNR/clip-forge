import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mocks = vi.hoisted(() => ({
  root: '',
  app: { isPackaged: false, getVersion: () => '1.0.0', getAppPath: (): string => '', relaunch: vi.fn(), exit: vi.fn() },
  spawn: vi.fn(),
  relaunchFails: true
}))
vi.mock('electron', () => ({ app: mocks.app, shell: {} }))
vi.mock('electron-updater', () => ({ autoUpdater: { on: vi.fn(), removeListener: vi.fn() } }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))

/** A fake child: git/npm steps succeed; the relaunch spawn fails the first time. */
function fakeProcess(command: string, args: string[]): EventEmitter {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(), stderr: new EventEmitter(), unref: vi.fn()
  })
  setTimeout(() => {
    if (command === process.execPath) {
      if (mocks.relaunchFails) child.emit('error', new Error('spawn EPERM'))
      else child.emit('spawn')
      return
    }
    if (command === 'git' && args[0] === 'pull') child.stdout.emit('data', Buffer.from('Updating abc123..def456\nFast-forward\n'))
    child.emit('close', 0)
  }, 0)
  return child
}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers({ toFake: ['setTimeout'], shouldAdvanceTime: true, advanceTimeDelta: 200 })
  mocks.root = mkdtempSync(join(tmpdir(), 'cutawan-source-update-'))
  mkdirSync(join(mocks.root, '.git'))
  writeFileSync(join(mocks.root, 'package.json'), JSON.stringify({ name: 'cutawan' }))
  mocks.app.getAppPath = () => mocks.root
  mocks.spawn.mockImplementation(fakeProcess)
  mocks.relaunchFails = true
  // A dev-server session relaunches through spawn, so the failure is observable.
  vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  rmSync(mocks.root, { recursive: true, force: true })
})

it('lets a retry finish an update whose restart failed, without pulling again', async () => {
  const updates = await import('../src/main/updates')
  await expect(updates.updateFromSource(() => {})).rejects.toThrow(/could not restart itself/)
  const pulls = (): number => mocks.spawn.mock.calls.filter(([cmd, args]) => cmd === 'git' && args[0] === 'pull').length
  expect(pulls()).toBe(1)

  // Retrying used to pull again, find nothing new and report "already up to date".
  mocks.relaunchFails = false
  await updates.updateFromSource(() => {})
  expect(pulls()).toBe(1)
  expect(mocks.app.exit).toHaveBeenCalledWith(0)
})
