# PR #59 follow-up checks — 19 September 2026

The previously interrupted combined corpus run has now finished: eight spoken sources produced 23 exports, and the silent source was rejected as expected. Windows packaged playback/export, copied-project compatibility, and the new optional ChatGPT/Codex provider were also exercised. These checks support continued review; they do **not** establish OpusClip parity or justify an automatic stable release.

## Combined corpus

| Source | Selected clips | Reviewed exports | Execution |
| --- | ---: | ---: | --- |
| Tears of Steel | 2 | 2 | Complete |
| Narrated screen demonstration | 5 | 3 | Complete |
| Gilly Forrester interview | 8 | 3 | Complete |
| Steve Wozniak interview | 14 | 3 | Complete |
| NASA static interview | 4 | 3 | Complete |
| Hannah Cloke interview | 5 | 3 | Complete |
| Automation/empathy presentation | 9 | 3 | Complete |
| Godot panel | 36 | 3 | Complete |
| Silent Blender tutorial | 0 | 0 | Expected no-audio rejection |

All 23 exports passed complete-file FFmpeg decoding. Automated checks reported no full-frame black intervals and no clip-edge overlaps with the source ASR word timestamps. These are mechanical checks, not independently labelled caption accuracy, audible word-cut accuracy, speaker accuracy or engagement measurements.

Six source/output frame pairs per export and the retained transcript/context were inspected. This was sampled visual/editorial review, **not continuous audiovisual viewing of every export**. Findings:

- The NASA static interview keeps a consistent, readable speaker crop. Interview close-ups generally preserve the visible speaker; some cuts change between a close-up and a much wider view.
- The Gilly puzzle clip retains the physical demonstration and its concluding reaction. Its wide fallback still uses relatively little of the vertical canvas.
- The screen demonstration's second and third exports use enlarged detail views. The first remains too small for comfortable mobile reading.
- The presentation's two slide-heavy exports preserve context but leave slide text small. The moving presenter reaches the crop edge in the first export; the final sampled frame partially cuts off his face.
- The Godot panel's first export remains a small wide view. The other two crop a group rather than tightly isolating a single speaker. This is conservative framing, not evidence of accurate active-speaker identification.
- The film exports repeat part of the same dialogue and retain very wide imagery. Semantic deduplication and stronger adaptation to a vertical canvas remain open.
- Awkward ASR wording remains visible in some retained transcripts, including the presentation. Zero ASR-boundary flags must not be described as error-free captions.

### Provenance

The six previously completed sources and their 17 exports were retained from the `2792784`-era runner. The presentation and panel resumes used the runner built from `9e52965`. This is a completed **resumed development run with mixed build provenance**, not a fresh all-source run of the final subscription-feature commit.

Source transcripts were cached; the two long sources used the corrected transcription-seam outputs. The experimental bridge used local faster-whisper large-v3 (CUDA float16, beam 5, VAD, word timestamps) and signed-in Codex CLI, rather than hosted Whisper plus the configured API analysis model. Earlier uncached inference used the CLI default with user config excluded; it was **not explicitly pinned to Luna**, and the requested `gpt-5.4-mini` API model label was ignored.

After the user requested cheaper testing, future uncached corpus requests were pinned to Luna/low with a hard ceiling. The panel resume reused all 40 analysis responses from cache and created no new inference jobs. Separately, one small live Luna request tested the new production provider. No full-corpus Luna quality comparison is claimed.

## Windows package and compatibility

The actual packaged `Cutawan.exe` reported `app.isPackaged === true` and loaded its `resources/app.asar`. Tests used isolated app/session data directories established before application initialization. This was an unsigned unpacked Windows build; installer installation, signing, macOS and Linux packages were not tested.

- A fresh NASA import created a 460-word transcript and four clip candidates through the packaged app. Following the cost-related interruption, its saved project was reopened, preview playback advanced with decoded 1280×720 source frames, and a vertical captioned clip was exported through the UI.
- A copied pre-change Wozniak project loaded with 14 clips. A clip title and a transcript word were edited and survived reopening. Other clips were unchanged, export succeeded, and the original project JSON remained byte-for-byte unchanged.
- Both saved-project checks were repeated against the final package containing the subscription feature. No renderer exceptions were recorded.
- With the subscription provider selected and its request cap set to zero, a fresh 12-second source excerpt was imported, transcribed locally, captioned and exported in the final package. The saved provider settings and the no-inference setup check worked through the UI.
- All three final packaged test exports passed complete-file decoding and contained video and audio.

The existing-project check covers this real fixture and current saved projects; it is not an exhaustive migration matrix for every historical version.

## Subscription feature checks

The production provider completed one small live `gpt-5.6-luna`/low request, then rejected a different request at its cap. Local transcription of a 12-second excerpt returned word timestamps. The packaged test exercised local transcription without an API key or a running test bridge.

Offline tests cover caching at cap zero, concurrent request reservations, a locked/corrupt ledger, model-specific cache separation, API-key login rejection, cancellation including Windows child processes, REST bypass, and failed-request accounting without retries or fallback. The default remains the existing API provider; subscription mode is an explicit beta option with manual prerequisites documented in [the setup guide](../../docs/chatgpt-subscription.md).

Final local gates: **430 tests / 53 files**, main and renderer TypeScript checks, ESLint, production build, Windows unpacked packaging, and whitespace validation passed. No additional algorithm changes were made to address the visual findings above in this follow-up.

## Local artifacts

Media and machine-specific test helpers remain excluded from Git. On the validation workspace:

- `.tmp/quality-corpus/combined-v9/index.html` — comparison gallery, linked output videos and source/output frames.
- `.tmp/quality-corpus/combined-v9/{run,review,metrics,provenance}.json` — source statuses, timings, decode measurements and provenance.
- `.tmp/release-validation/result.json` — final packaged saved-project/compatibility result.
- `.tmp/release-validation/subscription-final/result.json` — final packaged local-transcription result.
- `.tmp/release-validation/subscription-smoke/result.json` — bounded live provider result.
- `.tmp/release-validation/export-qc.json` — complete-file decode and stream probes.
- `.tmp/release-validation/package-final/win-unpacked/Cutawan.exe` — tested unsigned application.

These local paths will not resolve in a fresh GitHub checkout. The corpus catalog, implementation, regression tests and this written evidence are included in the PR. PR #59 remains a draft; no merge or release was performed.
