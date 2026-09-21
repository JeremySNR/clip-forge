# Reusing screen layouts without trusting a match

This is the next increment after v0.11.1, not completion of arbitrary-video support.

## Implementation

- Cloud waits no longer hold the local media slot. Individual analysis FFmpeg jobs share the existing memory/CPU admission queue with inference and exports. Analysis requests have a separate shared limit across ChatGPT and API providers: two at 8 GiB installed RAM or above, one below. API backoff does not hold a request slot. Subscription deduplication and locked daily-budget reservations are unchanged.
- Each source gets a small layout memory seeded from its saved, automatically checked screen compositions. Pending, manually corrected, rejected, older-analysis and camera examples are excluded. It retains at most 24 examples and compares at most eight nearby examples using 48×27 RGB thumbnails. Images are temporary; no model or dependency was added.
- An overlapping source interval or a similar thumbnail supplies only a candidate. The proposed geometry is re-rendered on seven samples of the new interval and checked against its narration. Margins are not reapplied cumulatively. Rejection falls through to ordinary proposal/verification once; it never silently applies a cached acceptance.
- Reused content crops also have a local edge veto. Contrast features touching a crop boundary request fresh bounds before spending a model review. This catches some cut labels and axes; it is deliberately conservative and is not OCR or continuous containment detection.
- Presenter review images now label SOURCE, BEFORE and AFTER. The prompt explicitly distinguishes expected repeated people across the comparison references from duplication inside the final output. Labels use the already-shipped ASS caption renderer: CI caught that `drawtext` was unavailable in the bundled Linux FFmpeg. Actual rendering tests cover font/subtitle paths containing spaces, apostrophes and filter-graph delimiters.

## Real-video checks, 2026-09-21

Used the previously authorized T3.GG source and ChatGPT subscription in isolated application data on the same 8 GiB Apple Silicon machine. The original project/settings were not changed. No source footage or generated media is included in the repository. Transcription and source assessments were reused where stated; these are layout experiments, not complete import-to-clips benchmarks.

| Experiment | Observed result |
| --- | --- |
| Retrieve the graph layout from 477.01–508.67s for the later graph at 664.16–692.11s | Local candidate lookup took 0.65s. It did not match the subsequent poll/dashboard or calculator screens. Matching is a heuristic, not evidence of output safety. |
| Initial concurrent reuse at 664.31–680.31s and 680.51–691.91s | Two fresh model reviews completed together in 27.78s and accepted both outputs. Human inspection found the moved graph title clipped in the latter output. This failed experiment motivated the local edge veto; it is not a quality success. |
| Repeat with edge veto | Both old crops were vetoed before model review; fresh proposals and reviews repaired them. Four fresh AI calls completed together in 42.14s. Inspected output retained the moved title. Repair can cost more than successful reuse. |
| Stable intervals 480.21–490.21s and 491.21–503.21s, with edge veto | Both reused layouts passed fresh checks, using two AI requests. Individual durations were 23.56s and 17.88s; batch wall time was 23.56s. This confirms overlap and request avoidance, not a universal speedup. This measurement preceded the final comparison-panel labelling change. |
| Synthetic top-left and bottom-left presenter variants | Rebuilt eight seconds of the same graph footage with the actual presenter moved to other corners. Automatic source detection and rendered review accepted separate panels. Top-left needed the stacked alternative (47.95s cold assessment + review); bottom-left used content-first (27.22s). Inspected resulting images. |
| Synthetic bottom-right variant | Initially rejected with a claim of duplicated presenter imagery, despite the source showing one presenter. After labelling the comparison panels, the unchanged source proposal passed a fresh review (11.36s including cached source assessment). Inspected output retained the graph and separate presenter. This is a targeted regression check, not an independent generalization result. |

The repaired 680.51–691.91s interval was also rendered with the original audio and captions through the normal exporter and decoded end to end. Cloud latency varies; the observations above are single trials, not averages. The last three corner cases are transformations of one development source, not three independent creator videos. Original top-right footage was tested in the previous release and the reuse trials.

## Automated checks

Regression tests cover concurrent composition while cloud review is blocked, foreground media admission during that wait, bounded API calls and queued cancellation, source-scoped example eligibility, local matching/rejection, copying geometry without accumulating margins, mandatory fresh review, repair after rejection, and the local clipped-title veto before model spending. Tests use actual FFmpeg where geometry and queue boundaries matter. The full suite, TypeScript, ESLint, build, CI offline renders/UI smoke, and packaged Mac checks gate the follow-up release.

## Remaining work toward the broader goal

1. Build and label a held-out corpus of independent screen tutorials, interviews, multiple presenters, gameplay, sports/action, moving insets, occlusions and rapid cuts. Use the existing quality benchmark and blind human review; record failures and repair time, not only successful examples.
2. Measure complete workflows and memory/CPU peaks on low-memory Windows/Linux as well as macOS. These experiments do not measure transcription or highlight selection latency.
3. Extend local containment checks to meaningful text/objects and temporal movement. The current edge veto is only a reuse guard, can reject harmless borders, and can miss low-contrast or between-sample clipping. Fresh proposals still rely on sampled model review and can be wrong.
4. Measure whether the layout-memory hit rate justifies its retrieval cost across real projects. It currently accelerates recurring screen geometry, not camera tracking or arbitrary scene understanding. An incorrect candidate can add one verification call before fallback.
5. Reduce false model rejections and repeated repair calls using independently validated source regions and clearer review inputs. Do not remove review gates to make the timing chart look better.

There is no claim that every format now works, that clips are guaranteed to perform well, or that all layout decisions are fast.
