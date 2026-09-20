// Only this child process loads native ONNX code. Never import it in Electron's main process.
import * as ort from 'onnxruntime-node'
import type { InferenceRequest, InferenceResponse, TensorData } from './protocol'

const sessions = new Map<string, ort.InferenceSession>()
process.on('disconnect', () => process.exit(0))
process.on('message', (request: InferenceRequest) => {
  void run(request).then(response => {
    if (process.connected) process.send?.(response)
  })
})

async function run(request: InferenceRequest): Promise<InferenceResponse> {
  const inputs: Record<string, ort.Tensor> = {}
  let results: ort.InferenceSession.ReturnType | undefined
  try {
    let session = sessions.get(request.modelPath)
    if (!session) {
      session = await ort.InferenceSession.create(request.modelPath, {
        logSeverityLevel: 3,
        intraOpNumThreads: 2,
        interOpNumThreads: 1,
        executionMode: 'sequential',
        enableCpuMemArena: false,
        enableMemPattern: false
      })
      sessions.set(request.modelPath, session)
    }
    for (const [name, input] of Object.entries(request.inputs)) {
      inputs[name] = new ort.Tensor('float32', input.data, input.dims)
    }
    results = await session.run(inputs)
    const outputs: Record<string, TensorData> = {}
    for (const [name, tensor] of Object.entries(results)) {
      if (tensor.type !== 'float32') throw new Error(`Unexpected inference output type: ${tensor.type}`)
      // Own the data before disposing the native tensors.
      outputs[name] = { data: new Float32Array(tensor.data as Float32Array), dims: tensor.dims }
    }
    return { id: request.id, outputs, peakRssBytes: process.resourceUsage().maxRSS * 1024 }
  } catch (error) {
    return { id: request.id, error: error instanceof Error ? error.message : String(error) }
  } finally {
    for (const tensor of Object.values(inputs)) tensor.dispose()
    for (const tensor of Object.values(results ?? {})) tensor.dispose()
  }
}
