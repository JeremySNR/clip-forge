export interface TensorData {
  data: Float32Array
  dims: readonly number[]
}

export interface InferenceRequest {
  id: number
  modelPath: string
  inputs: Record<string, TensorData>
}

export interface InferenceResponse {
  id: number
  outputs?: Record<string, TensorData>
  error?: string
  peakRssBytes?: number
}
