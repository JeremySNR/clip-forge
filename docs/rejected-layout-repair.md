# Recovering from rejected source bounds

The v0.11.3 user run of the T3.GG video “Jev is incredible” exposed a failure not covered by the original graph example. Most failed shots had broad source rectangles that could not meet the content-enlargement threshold. Another proposal combined two disconnected webcam panels into one tall rectangle. The editorial-panel path stopped after rejection instead of asking for corrected bounds, leaving a full-frame fit after substantial analysis time.

## Changes

- Return actionable geometric feedback: broad content, small presenter, or overlapping/invalid source bounds. The content enlargement and presenter resolution limits remain unchanged. Reject unusable geometry before rendering proof images.
- A rejected editorial or reused proposal now falls through to source-region repair. Send the rejected bounds and reason alongside the source samples. A maximum of two per-shot source proposals allows an inset correction to expose and then repair an independent content-size problem; there is no recursive retry loop.
- Require one contiguous presenter panel in proposal instructions. A primary commentator and an embedded speaker must not be enclosed together merely because both are on the same side.
- Offer **Retry automatic layout** for failed automatic layouts. It analyses the selected clip through the configured provider, keeping the transcript and clip selection. Manual framing and region choices disable retry and are protected if made while analysis is running.
- Revision metadata prevents stale title/caption saves from restoring the pre-retry letterbox. Exports join active retries, including when the saved clip is already marked done. Concurrent retry callers share work; trim continuations retain retry intent.

## Real-video checks, 2026-09-21

The user approved sampled frames and matching transcript from two clips, initially with six requests, then explicitly extended the isolated test cap to eight. The test used a separate application-data directory and clip copies. The real project and its subscription ledger were not modified. Seven requests were used; no further cloud tests were made.

| Case | Result |
| --- | --- |
| “This AI Is Up to 200x Faster”, 667.92–681.36s | The saved proposal included an empty left margin. A fresh tighter proposal and rendered review completed in 28.40s (two requests). Output has a separate top-right presenter and enlarged comparison table. Inspected beginning, middle and end images. A thin page-colored strip remains beside the presenter, so this is not a claim of perfect framing. |
| “100 Emails Classified Almost Instantly”, 1237.24–1267.09s | Initial repair still merged the primary and embedded webcams; both rendered templates rejected it (55.08s, three requests). Explicit single-panel instructions corrected the webcam, but the content crop remained too broad (28.72s, one request). A final geometric repair expanded into the presenter instead (17.23s with cached first proposal, one fresh request). The clip remains rejected. This is an unresolved automatic-content-selection failure, not a successful repair. |

These timings are targeted layout checks using existing transcript and source assessments, not complete import-to-clips timings or proof of general speedup. New repair calls can add latency when the model keeps proposing bad regions. The test did not rerun every clip or independently validate arbitrary video styles.

## Remaining work

1. The email demo needs content selection that understands the narrated metrics and their relationship to the broader table. Repeatedly proposing the entire application window cannot solve portrait readability, overlapping overlays, or information already hidden in the source. Improve the proposal strategy with labelled region candidates/overview-and-detail layouts, then verify the actual output.
2. Measure and limit total per-clip request count and latency across segmentation, proposals and reviews. Avoid treating every scroll as a new semantic scene or reviewing alternate templates when the source bounds themselves are wrong.
3. Build a corpus of independent recordings, including multiple webcam overlays, nested videos, scrolling pages and text-heavy dashboards. Track rejected coverage and elapsed time over whole projects rather than reporting selected successes.
4. Add clearer per-shot correction and missing-frame evidence. The retry action reruns one clip's layout; it is not a project-wide resumable job system or a guarantee of successful automatic framing.

Regression tests cover broad/overlapping proposals, bounded failures, fresh verification after repair, explicit retry coalescing, stale saves, exports waiting for retry, trim continuation and concurrent manual choices. CI also gates packaged Mac inference/export, Linux rendering and desktop smoke tests.

All 523 local tests, type checking and lint pass. Read-only Bugbot review identified three retry races, which were fixed and re-reviewed without further findings. The accepted comparison clip was exported through the ordinary layout/merge/render path with captions and original audio: 1080×1920, 29.97 fps, 13.447 seconds, full decode passed.
