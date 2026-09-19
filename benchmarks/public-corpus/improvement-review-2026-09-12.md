# Video-quality improvements — 12 September 2026

The first iteration fixes reproducible boundary and framing failures. **This is progress toward OpusClip quality, not evidence of parity.** The remaining screen-readability, speaker-identity, transcription and multimodal-selection failures are substantial.

- [Play the before/after comparisons](../../.tmp/quality-corpus/improvement-review/index.html)
- [Per-clip editorial notes](improvement-review-notes.json)
- [Measurements](../../.tmp/quality-corpus/improvement-review/metrics.json)
- [Compiled-runner provenance](../../.tmp/quality-corpus/improvement-review/provenance.json)
- [Original baseline and method](full-review-2026-09-12.md)
- [Source credits and licences](README.md)
- [Controlled face-detector and mouth-detail study](speaker-detail-study-2026-09-12.md)
- [Visual-payoff repair study and rendered demonstration](visual-story-study-2026-09-12.md)
- [Content-region enlargement study and four comparisons](content-region-study-2026-09-13.md)
- [Screen overview/detail study and four comparisons](screen-detail-study-2026-09-13.md)
- [Transcription join repair study and caption comparisons](transcript-seam-study-2026-09-13.md)
- [Title-blind editorial coherence study and reviewed clips](editorial-coherence-study-2026-09-13.md)

## Implemented changes and observed results

| Change | Evidence | Remaining limitation |
| --- | --- | --- |
| Neighbour-aware pre/post-roll, idempotent end normalization, and editorial ending refinement | Source-word boundary overlap flags fell from **11 of 24 baseline exports to 0 of 24 v1 exports**. Wozniak's diploma anecdote and the Hannah/Gilly explanations stop before the next question or host thanks. The panel publisher story no longer ends with the stray “Because”. | A word-safe cut can still be a poor story boundary. Word timestamps are ASR estimates, not independent acoustic ground truth. Rankings also changed in v1. |
| Fade only in available transcript-derived tail | Replaces the fixed 0.4-second fade that could attenuate a final word. Hidden caption words still constrain available speech-free tail. | Not a waveform/VAD-verified silence detector; subjective listening remains outstanding. |
| Source-aware visual review and explicit layout constraints | The puzzle, slides, robot hand and screen controls remain visible rather than being discarded merely because a face was detected. Additional zoom is disabled where margins are uncertain. | Full-frame fit can leave useful content far too small; it is a conservative fallback. |
| Crop review against actual tracked composition, per camera shot | The uncanny-valley example keeps the graph, crops the talking section, then returns to the graph. Static NASA shots now receive crop review too, yielding useful close views instead of unnecessary wide strips. | Three low-resolution pairs per shot can miss brief events. The crop judge is an LLM estimate, not an independent evaluator. |
| Separate dissolve intervals from stable shots | Incoming slide content no longer causes the entire preceding talking shot to be classified as a slide. Fit is retained through the transition. Crop-to-crop transitions avoid a one-frame fit flash. | Custom frame-difference thresholds need broader validation; this is not an implementation or proven replacement of AutoFlip. |
| Conservative guard for shots with insufficient face detail | V6 preserved Gilly's production-wide shot instead of isolating the listener. V8 can follow her after recovering mouth detail, while uncertain panel shots still preserve the group. | The guard itself does not improve speaker identity accuracy. It trades close-up detail for retaining the scene; group views are still too small. |
| Higher-resolution detection and preserved mouth detail | YuNet recovered missed panel/interview faces. With identical YuNet tracks, increasing mouth-crop decode width from 640 to 1920 changed the Gilly wide-shot target from mostly listener to Gilly in 181/182 sampled frames. Final Gilly/Hannah samples follow the speaking participant. | One targeted regression, not general speaker accuracy. Some panels remain uncertain and retain a group view. Wider framing still wastes space. |
| Shared editor/export composition | Built Electron preview correctly switches contain → cover → contain at three scrubbed source times, with captions updating and no renderer errors. Tracked face centres now map to CSS crop travel rather than being used directly as object-position percentages. | Verified at sampled paused states; continuous playback and all aspect ratios still need broader visual validation. |
| Explicit no-audio handling | Silent Blender source now reports that speech-based clip selection needs spoken audio rather than failing deep in FFmpeg. | Visual-only candidate generation is not implemented. |
| Protected visual payoffs shared by export and preview | The popcorn introduction now continues into the mechanism and drum reveal in a 43.12-second export, removing waiting gaps. Three complete interview/demo controls were correctly left alone. Preview playback skips the wait and retains the protected footage. | One repair and three controls; sparse frames are not full motion/audio understanding. The reveal still occupies too little of the portrait frame. |

The low-detail guard was motivated by actual LR-ASD tracks: Gilly's normal shot had mean face area around 0.039, while the final wide-shot detections were around 0.0006 and the speaking face largely dropped out. Positive speaking scores persisted on tiny detections. The first guard required face area at least 0.0025 in at least 30% of a shot's frames. The final revision also accepts small faces with at least 32 equivalent pixels in the actual decoded frame, a speaking logit above 1 and a margin above 1 over rivals. This lets recovered mouth detail support a crop while retaining uncertain shots. These are provisional composition thresholds, not calibrated probabilities or validated universal cutoffs. Explicit talking-head mode remains a user choice. See the controlled study for the measured tradeoffs.

## Runs and checks

| Run | Exported clips | Full decode passed | Full-frame black intervals | Clips with word-boundary overlap |
| --- | ---: | ---: | ---: | ---: |
| Original full baseline | 24 | 24 | 0 | 11 |
| Full selection/boundary/visual iteration v1 | 24 | 24 | 0 | 0 |
| Shot-layout v2 | 6 | 6 | 0 | 0 |
| Actual-crop review v3 | 6 | 6 | 0 | 0 |
| Dissolve handling v4 | 6 | 6 | 0 | 0 |
| Static-shot review and transition bridging v5 | 9 | 9 | 0 | 0 |
| Low-detail speaker fallback v6 | 6 | 6 | 0 | 0 |
| Detector and mouth-detail revision v7 | 6 | 6 | 0 | 0 |
| Final all-source framing regression v8 | 24 | 24 | 0 | 0 |

There were **87 newly rendered comparison exports** after the 24-export baseline. These reuse selected source moments; they are not 87 independent examples. The latest gallery uses **all 24 v1 selections, reanalysed and rendered with v8 framing across all eight spoken-video sources**. Source transcripts and selected moments were reused; transcription and initial selection were not rerun in v8. V1 predates endpoint-near visual sampling; later framing reviews use it. Compiled runner hashes distinguish the iterations.

Overlap means the source cut lies more than 10 ms inside both endpoints of a source ASR word. The same source transcript timestamps are used on both sides of the comparison. This is a risk indicator and does not establish that 11 audible errors were heard or that all final words are acoustically intact.

Current checks: **414 tests passed across 50 files**, Node and renderer TypeScript checks passed, ESLint passed, production Electron/Vite build passed. Native preview evidence lives in [preview-check/result.json](../../.tmp/quality-corpus/preview-check/result.json) and three screenshots alongside it. That test uses the v8 mixed-layout project in an isolated user-data directory, with background frame throttling disabled for settled screenshot capture. Later studies linked above include their additional export, playback, resize, manual-override, transcription and editorial checks. Normal app settings were not changed.

Six final Gilly/Wozniak exports were retranscribed locally from their rendered audio. Their intended closing phrases survive and the excluded next questions do not reappear in those transcriptions. [Audio audit](../../.tmp/quality-corpus/shot-layout-v8/rendered-speech-audit.json). This is a same-ASR cross-check, not independent listening or proof of word-level acoustic precision; wording still varies between passes.

The existing ChatGPT sign-in supplied the LLM through the experimental Codex CLI bridge; local faster-whisper large-v3 supplied transcription. No Platform API key was required for these runs. The requested API model name is ignored by this bridge; the actual model is the Codex CLI default with user configuration excluded. This bridge remains a local test helper, not an installed Settings provider. Source frames and prompt text were sent through signed-in Codex; transcription remained local.

## Next work, in priority order

1. **Improve readable composition, not just safe fit.** Detect relevant object/UI rectangles, retain essential regions and use a detail view with context. The higher-resolution face detector and preserved mouth detail are now implemented; next use subject bounds for vertical position/scale and compare group layouts against close-ups. Evaluate on the existing puzzle, graph, screen controls and production-wide shots.
2. **Separate audio diarization from visible-speaker association and measure both.** Build independent labels for who speaks, who is visible, overlap and off-screen speech; compare the current LR-ASD association with alternatives on held-out footage. Report wrong-person screen time, switch delay and unassigned time. Do not replace the current algorithm solely because another model reports a higher benchmark score.
3. **Compare forced word alignment and transcription correction.** The film's suspicious transition timing, “robotic glass”, duplicated words and split compounds need audio-grounded checks. Use a separate aligner and independently checked excerpts; prevent LLM correction from inventing words. Fix caption placement around text/objects and source shirt lettering.
4. **Generate candidates from visual events as well as speech.** A bounded repair now includes the popcorn demonstration and protects it from speech-only tightening, but general visual-event candidate generation and silent sources remain unsupported. Candidate units should combine discourse, shots/actions and demonstrated outcomes. Require the actual opening to be comprehensible and the promised payoff to occur inside the clip; rerun metadata after material trims.
5. **Use blinded preference and matched OpusClip comparisons.** Compare the same sources and output constraints with independent raters. Technical correctness, self-reported model scores and a few repaired examples cannot establish equivalent engagement or retention.

## Method choices and research

The direction of shot boundaries, salient-region constraints and fallback composition is consistent with [Google's AutoFlip description](https://research.google/blog/autoflip-an-open-source-framework-for-intelligent-video-reframing/). This project currently uses its own simpler implementation and has not demonstrated AutoFlip-equivalent performance. [OpusClip's layout documentation](https://help.opus.pro/docs/article/layout-and-reframing) illustrates why fill/fit alone is an incomplete composition toolkit.

[WhisperX](https://arxiv.org/abs/2303.00747) provides an audio-grounded forced-alignment approach to compare against current timestamps; it has not yet been integrated here. The [official LR-ASD implementation](https://github.com/Junhua-Liao/LR-ASD) supplies evaluation routes, but published benchmark accuracy does not validate ClipForge's detector, tracking, crop policy or this corpus. [AVA's labelled data](https://sites.research.google/gr/ava/download/) is a possible independent evaluation source; it has not yet been downloaded or evaluated in this iteration.

No subjective listening, continuous-motion editorial viewing, human speaker labels, audience retention measurements or matched OpusClip exports were completed. The corpus is predominantly English and lacks important remote-call, overlapping-speech, multilingual and sports/gameplay cases. These limits prevent a responsible parity claim and identify concrete work still to do.
