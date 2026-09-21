# Layout-first correction: validation and limits

## Problem and change

The original flow assessed every candidate visually, then ran dense active-speaker inference before proposing screen layouts. Fixed webcam insets paid the same tracking cost as camera footage. Rejected regions could retain a whole-frame letterbox, and a later failure could leave every saved clip pending. ChatGPT subscription calls also ran strictly one at a time.

The correction adds screen/camera/mixed evidence and stable source-panel proposals to the existing visual assessment. Screen footage skips speaker inference; source proposals go directly to rendered verification. Camera and mixed footage retain the existing speaker path. When a stable composition cannot be established, a CPU-only 160-pixel-wide, 4 fps pass detects large screen changes. Nearby changes are grouped into a brief full-scene interval while the UI settles; stable sections get individual regions grounded in their own narration. Only one segmentation retry is allowed. Existing shot/graph limits still bound complex clips.

Content panels are larger and automatically proposed content gets containment margins before verification. Manual rectangles are untouched. Every completed layout is saved immediately. Later B-roll/thumbnail checkpoints do not replay stale layouts. Legacy generated letterboxes migrate once on opening/export; accepted composites and custom source corrections remain intact.

Subscription requests have a separate ceiling of two concurrent jobs on machines with at least 8 GiB installed RAM, one below that. Usage reservations remain serialized and protected by the existing cross-process lock. The ledger is replaced atomically. Identical requests wait for the existing cache write; cancelling one waiter does not cancel another caller or remove its cache barrier. No API fallback or change to the user's daily allowance is introduced.

## Real source used

With the user's explicit permission, sampled frames and matching transcript from their local T3.GG recording, “Please stop using stupid models,” were analysed using their configured ChatGPT subscription/model. Tests used isolated application data; the original project, transcript and settings were not modified. No footage is committed to this repository or published with the release.

Host: Apple Silicon macOS, 8 CPU cores, 8 GiB RAM. Source: 1920×1080, 29.97 fps, 27m09s. Transcription was reused. These checks do **not** measure full-source transcription, highlight selection, or a complete new-project workflow.

| Selected interval | Observation |
| --- | --- |
| 477.01–508.67s, response-quality graph | Automatically separated graph and presenter; rendered/exported with captions and checked in the native Electron preview. The old speaker stage alone took 24.25s. An initial cold source-assessment + layout-review run took 23.16s, before the final added containment margins. Final-margin run took 14.56s with the source assessment cached and rendered review uncached. |
| 1360.88–1446.83s, calculator demonstration | Automatic separate calculator/presenter layout; inspected rendered samples. Initial cold assessment + layout review took 31.98s. |
| 228.13–281.07s, posts followed by diagram | A larger content destination made the proposed tall content region geometrically useful; rendered review accepted the composition. This example still relies on sampled model verification. |
| 664.16–710.97s, graph changing to dashboard/poll | A whole-clip rectangle was rejected. Per-section analysis produced graph and poll layouts covering about 90% of the selected interval, retaining the full scene for the 4.60s app/dialog transition. Final layout pass took 75.86s, excluding the cached 3.05s source assessment. One alternate presenter template was needed. This complex case is still noticeably slower. |

Two uncached source assessments also ran concurrently on this 8 GiB host: individual durations were 13.94s and 16.72s, with total wall time 16.72s. This verifies overlap, not an end-to-end 2× speedup.

Timings are individual observations, not averages or speedup claims across machines. The old 24.25s speaker pass is only one component of the previous pipeline, not its total runtime. Subsequent runs may use the subscription cache, so cold and warm figures must not be compared as algorithmic speedups.

## Regression and desktop checks

- Automated cases cover screen routing, camera/mixed tracking, explicit talking-head preference, trim coverage, cancellation, source-panel proposal/verification separation, native-resolution rendering, scene timing and transient grouping.
- Persistence tests cover partial completion, manual regions, legacy letterbox upgrades, and an ordinary save racing the upgrade.
- Subscription tests cover cap enforcement under concurrency, bounded parallel work, duplicate requests, cancelled duplicate waiters, cache use at cap zero, and no API fallback.
- The real graph clip was opened in an isolated native Electron profile. One video clock drove the composited canvas and captions; playback and pause worked without renderer errors.
- Full test, TypeScript, lint and production build gates are required before merge; CI repeats the static gates. Release builds validate packaged macOS inference/export and publish all platform assets together.

## What this does not establish

- No guarantee for every video style. Sports, gameplay, moving/overlapping insets, multiple presenters, subtle fades, fast motion and different creator layouts still need a held-out corpus and human ratings.
- Fixed regions and seven rendered samples cannot certify every frame. Model review can miss clipping or misread text; added margins reduce common tight-box errors but are not independent OCR/continuous containment validation.
- Large screen changes are detected only on the repair path. Small movements between samples may be missed. Transient full-scene sections are intentional, and remaining rejected layouts still need manual review.
- Complex changing layouts can still take over a minute per clip. Further work should prioritize reusing verified source-layout families across clips, reducing model round trips, and measuring complete workflows on low-memory Windows/Linux as well as macOS. Do not spend that budget on more dense speaker inference for screen recordings.
- Per-clip checkpoints are useful recovery, not a durable resumable job engine. Reanalysis of the whole project still passes through the existing pipeline/cache rather than resuming an exact saved stage.
- There is no measured audience-retention improvement and no universal “best clip” claim.
