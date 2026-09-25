import type { TimeRange } from './types'
import { MAX_SUBSCRIPTION_IMAGES } from './subscription'

/** Sparse source-wide discovery. Evidence times are requested seeks, not decoded PTS. */
export interface SourceMomentCandidate {
  id: string
  start: number
  end: number
  title: string
  summary: string
  reason: string
  /** Editorial proposal score, not a prediction of views or virality. */
  score: number
  kind: 'demonstration' | 'visible-result' | 'reaction' | 'visual-story'
  evidence: Array<{ time: number; role: 'before' | 'action' | 'result'; observation: string }>
  /** Keep the observed event together when trimming silence. */
  protectedRange: TimeRange
  sampleTimes: number[]
  timingUncertaintySec: number
}

export interface SourceDiscoveryWindow {
  start: number
  end: number
  /** Requested sampling timestamps. Extraction can seek up to 1s earlier. */
  sampleTimes: number[]
  status: 'scanned' | 'failed'
  failure?: 'frames-unavailable' | 'analysis-failed' | 'invalid-response'
}

export interface SourceDiscoveryReport {
  version: 1
  generationId?: string
  configuration: {
    version: string
    requestedModel: string
    provider: 'api' | 'chatgpt'
    /** Null when the effective subscription model was not supplied by settings. */
    effectiveModel: string | null
  }
  status: 'complete' | 'partial' | 'failed'
  sourceFingerprint: string
  durationSec: number
  createdAt: string
  cacheHit: boolean
  candidates: SourceMomentCandidate[]
  /** Filled by the pipeline after completing speech boundaries and merging candidates. */
  admittedCandidateCount?: number
  boundaryRejectedCandidateCount?: number
  windows: SourceDiscoveryWindow[]
  plannedWindowCount: number
  successfulWindowCount: number
  failedWindowCount: number
  /** Valid coarse proposals before deduplication and bounded refinement. */
  proposedCandidateCount: number
  /** Invalid coarse proposals plus unsuccessful/rejected refinement attempts. */
  rejectedCandidateCount: number
  refinementCount: number
  successfulRefinementCount: number
  failedRefinementCount: number
  /** Logical model calls; the provider client can retry a failed call. */
  analysisRequestCount: number
  /** Largest gap in the source-wide scan, including source edges and failed windows; refinements are separate. */
  maximumSampleGapSec: number
  samplingUncertaintySec: number
  limitations: string[]
}

export const SOURCE_DISCOVERY_BUDGET = {
  maxWindows: 8,
  framesPerWindow: 8,
  maxRefinements: 4,
  framesPerRefinement: MAX_SUBSCRIPTION_IMAGES,
  maxAnalysisRequests: 12
} as const
