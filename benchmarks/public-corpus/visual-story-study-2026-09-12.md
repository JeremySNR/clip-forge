# Preserving a visual payoff — 12 September 2026

The popcorn-robot candidate previously stopped after its spoken introduction. The following footage contains the actual installation, but speech-only pause removal would discard it. This pass adds protected visual intervals shared by export and preview, plus a bounded completion attempt for candidates explicitly identified as missing a promised demonstration.

## Observed result

- Original selection: source **1872.58–1885.51**, approximately 12.96 seconds rendered, introduction only.
- Repaired selection keeps source **1872.58–1885.61**, **1897.727–1909.693**, and **1927.643–1945.743**. The final interval includes the drum installation after the popcorn mechanism.
- Actual output: **43.12 seconds**, 1080 × 1920, 25 fps. The raw source span is 73.16 seconds; waiting gaps are excluded from the output.
- Full FFmpeg decode passed, no full-frame black intervals detected. Integrated loudness **−14.1 LUFS**, true peak **−0.4 dBFS**. This is measured export audio, not a subjective listening judgment.
- Six source/output frame pairs inspected. The mechanism and drum reveal survive; captions stop during the wordless demonstration. The full-frame fit still wastes substantial portrait space and retains the source's white side borders.
- Native Electron preview scrubbed correctly to setup, mechanism and reveal. Actual playback across the first removed wait landed at source **1897.730**, inside the protected mechanism interval. No renderer errors. Displayed playback duration is 43.1 seconds; clip cards now calculate edited duration too.

[Rendered clip](../../.tmp/quality-corpus/visual-story-v1/automation-empathy-talk.mp4), [source/output frames](../../.tmp/quality-corpus/visual-story-v1/review/automation-empathy-talk/rank-3/comparison.jpg), [run and model assessments](../../.tmp/quality-corpus/visual-story-v1/run.json), [decode/audio details](../../.tmp/quality-corpus/visual-story-v1/review/automation-empathy-talk/rank-3/decode-audio-qc.log), [native preview evidence](../../.tmp/quality-corpus/visual-story-preview-check/result.json).

## Method and controls

Visual review samples the planned tightened edit. If it explicitly identifies a promised but missing visual demonstration, the completion stage inspects sixteen following frames over at most 90 additional seconds and no more than 120 seconds from the original start. It can propose up to three intervals using observed frame indices. Deterministic validation enforces valid source times and the requested maximum **edited** duration, preserves a crossing final word, and invalidates old framing analysis. A second visual review evaluates the repaired edit. Production recommendation excludes a known incomplete candidate if repair fails or cannot be verified; it does not repeatedly extend it.

The real-video experiment used the existing v8 candidate and transcript, not fresh candidate discovery or transcription. One missing-payoff case was flagged and repaired. Three controls were not flagged: Wozniak's complete diploma anecdote, Gilly's puzzle demonstration, and NASA's static explanation. This is four targeted examples, not a precision/recall benchmark. The second review judged the payoff present but noted that the control mechanism remained sparsely explained. Its score is an uncalibrated editorial estimate, not measured engagement.

The experiment uses the existing signed-in Codex CLI bridge and local cached Whisper transcript. It does not install a ChatGPT provider in Settings. The bridge ignores the API-shaped model name and uses the Codex CLI default. Candidate score/old visual-summary fields in the raw experimental object originated in v8; the production pipeline refreshes the visual assessment after repair, and the final code refreshes the repair rationale. The rendered pixels are unaffected by those descriptive fields because the title overlay is disabled.

## Validation and limitations

**380 tests across 43 files**, both TypeScript projects, ESLint, production build, and patch whitespace checks passed. Added regressions cover a wordless tail, no spoken words, invalid/clamped ranges, nested intervals, maximum edited duration, finishing a crossing word, sampling the kept footage, and inverse timeline mapping at a cut. React changes use memoized transcript-derived duration and the same time map as export; playback controls have accessible labels.

This does not solve general visual-event discovery or silent-video selection. Sparse stills can miss motion, brief outcomes, and sound-dependent meaning. A generated description cannot establish mechanical causality or audible performance. The existing opening remains conversational, and the repaired clip's composition needs improvement. Independent listening, broader false-positive/negative testing, audience preference, and a matched OpusClip comparison remain outstanding.

Compiled experiment runner SHA-256: 63e2509bc6f512711c351d63f7397d05316745135c59c78fa7ceb2e09b2c6b18. This is one additional export beyond the preceding 87 comparison exports. The 24-clip gallery remains the v8 comparison; this repair is linked separately above.
