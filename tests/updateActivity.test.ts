import { expect, it } from 'vitest'
import { UpdateActivity } from '../src/main/updateActivity'

it('blocks restart until every concurrent operation finishes, including failures', async () => {
  const activity = new UpdateActivity()
  let finishSave!: () => void
  const saving = activity.run(() => new Promise<void>((resolve) => { finishSave = resolve }))
  let failExport!: (error: Error) => void
  const exporting = activity.run(() => new Promise<void>((_resolve, reject) => { failExport = reject }))
  expect(() => activity.requireIdle()).toThrow('before restarting')
  finishSave()
  await saving
  expect(() => activity.requireIdle()).toThrow('before restarting')
  const failure = expect(exporting).rejects.toThrow('Export failed')
  failExport(new Error('Export failed'))
  await failure
  expect(() => activity.requireIdle()).not.toThrow()
})
