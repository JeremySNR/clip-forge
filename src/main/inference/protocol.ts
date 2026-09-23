export interface TensorData {
  data: Float32Array
  dims: readonly number[]
}

export interface InferenceRequest {
  id: number
  modelPath: string
  inputs: Record<string, TensorData>
  /**
   * Run a stateful voice-activity model over a window of a 16 kHz s16le PCM
   * file inside the worker, instead of one request per 32 ms chunk. `inputs`
   * then carry the recurrent `state` and the previous chunk's `context`.
   */
  vad?: { pcmPath: string; fromSample: number; sampleCount: number }
}

export interface InferenceResponse {
  id: number
  outputs?: Record<string, TensorData>
  error?: string
  peakRssBytes?: number
}
