import type { SourceDiscoveryReport } from '@shared/sourceAnalysis'

/** Describes sampling coverage, never certifies continuous-video understanding. */
export default function DiscoverySummary({ report, earlierAttempt = false }: { report?: SourceDiscoveryReport; earlierAttempt?: boolean }): React.JSX.Element | null {
  if (!report) return null
  const frames = report.windows.filter(w => w.status === 'scanned').reduce((n, w) => n + w.sampleTimes.length, 0)
  const label = report.status === 'complete' ? 'Visual scan completed' : report.status === 'partial'
    ? 'Visual scan incomplete' : 'Visual scan failed'
  return <details className="mt-4 rounded-xl border border-surface-700 bg-surface-900 px-4 py-3 text-xs text-zinc-400">
    <summary className={report.status === 'complete' ? 'cursor-pointer text-zinc-300' : 'cursor-pointer text-amber-300'}>
      {earlierAttempt ? 'Latest attempt (earlier clips retained) · ' : ''}
      {label} · {report.candidates.length} visual {report.candidates.length === 1 ? 'proposal' : 'proposals'}
      {report.cacheHit ? ' · reused saved scan' : ''}
    </summary>
    {earlierAttempt && <p className="mt-2 text-amber-300">This scan is from the latest analysis attempt. The saved clips are from an earlier run.</p>}
    <p className="mt-2 leading-relaxed">
      {frames} sampled frames across {report.successfulWindowCount}/{report.plannedWindowCount} source sections.
      {' '}Largest gap between source samples: {report.maximumSampleGapSec.toFixed(1)} seconds.
      {' '}This is a sampled review; brief actions and motion between frames can be missed.
    </p>
    <p className="mt-2 leading-relaxed">
      {report.successfulRefinementCount}/{report.refinementCount} closer event reviews succeeded.
      {' '}{report.analysisRequestCount} analysis calls in the original scan; provider retries may add requests.
      {' '}Visual proposals still pass through clip-length and editorial checks.
    </p>
    {report.boundaryRejectedCandidateCount !== undefined && report.boundaryRejectedCandidateCount > 0 &&
      <p className="mt-2 leading-relaxed">{report.boundaryRejectedCandidateCount} visual proposals could not fit the selected
        {' '}length while preserving their action and crossing speech. Try a longer clip length.</p>}
    {report.failedWindowCount > 0 && <p className="mt-2 text-amber-300">
      {report.failedWindowCount} source {report.failedWindowCount === 1 ? 'section was' : 'sections were'} not reviewed successfully.
      {' '}Regenerate with visual discovery enabled to retry the scan.
    </p>}
    {report.limitations.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-4">
      {report.limitations.map((limitation, i) => <li key={i}>{limitation}</li>)}
    </ul>}
  </details>
}
