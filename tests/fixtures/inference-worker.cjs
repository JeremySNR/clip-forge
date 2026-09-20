process.on('disconnect', () => process.exit(0))
process.on('message', ({ id, modelPath, inputs }) => {
  if (modelPath === 'crash') return process.kill(process.pid, 'SIGKILL')
  if (modelPath === 'hang') return
  if (modelPath === 'error') return process.send({ id, error: 'bad model' })
  process.send({ id, outputs: inputs })
})
