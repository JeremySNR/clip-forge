# Recovering speech at transcription joins — 13 September 2026

The corpus exposed a caption failure in long recordings: the later audio chunk omitted opening speech, while the earlier chunk recognised it. The nominal timestamp ownership rule discarded the earlier words anyway. This affected three of the four chunk joins in the two long spoken recordings inspected here.

[Play the caption comparisons](../../.tmp/quality-corpus/transcript-seams/index.html). The comparisons are three 15-second diagnostic source intervals with identical manual full-frame fit and caption styling; they are not fresh editorial selections or publish-ready highlights.

## Evidence and production result

| Source join | Previously omitted passage | Updated production output |
| --- | --- | --- |
| Godot panel, 1196 seconds | “they saw our game performing well on Steam” | Recovered after the remaining overlap disagreement triggered a short audio repair. |
| Godot panel, 2388 seconds | “it worked” and the explanation that the demo was catching up | Recovered by the later chunk after its context prompt was corrected. |
| Automation presentation, 2388 seconds | “because our time is over” | Recovered by the later chunk after its context prompt was corrected. |
| Automation presentation, 1196 seconds | No sustained omission in the compared overlap | No short repair requested. |

The passages are supported by the earlier chunk and short source-audio re-decodes, not inferred by a text-only LLM. This is corroborating ASR evidence, not an independently transcribed reference. The source recordings and rights are catalogued in [the corpus README](README.md).

Four independent 40-second source excerpts were first decoded locally to inspect the failures. An anchored repair replay on the cached original transcriptions recovered the three missing passages and left the coherent join alone. The production path was then rerun for both recordings. Their first 20-minute chunks reused the exact-audio cache; four later chunks were decoded again with corrected context, and one remaining suspect join used a new 40-second audio pass assembled from the actual upload files. No LLM analysis or text correction was involved in this study.

## Implemented method

1. **Keep the context prompt before the next audio file.** Previously, the prompt included the previous chunk's entire trailing text, including speech already present in the next file's overlapping opening. Now only trusted segments ending before that next file begins can prime its request. A segment crossing the boundary is excluded rather than guessing which portion precedes it.
2. **Detect substantial overlap disagreements.** Compare the independently decoded words around the nominal join. Three consecutive unmatched words with at least two distinct normalized tokens trigger inspection; single-word differences do not. Timing tolerance is 1.25 seconds. These are provisional thresholds, not calibrated error probabilities.
3. **Check actual audio.** Assemble up to 20 seconds on each side of the join from the existing upload files, with no duplicated overlap. Decode that 40-second interval without a context prompt. At least 16 seconds of context on each side is required.
4. **Replace only between matching anchors.** Three-word sequences must agree on each side, 4–16 seconds from the join, with start/end drift at most one second. The closest compatible pair bounds the replacement by word indices. Alternate anchors are considered if the nearest pair conflicts with surrounding timings. Small edge discrepancies are clipped by at most 150 ms; incompatible timing, missing anchors or an empty patch retain the original transcript.
5. **Preserve normal operation.** Optional repair failures retain the completed transcript and log a warning. Cancellation propagates; temporary audio is cleaned up. Single-chunk recordings make no additional requests. Existing saved transcripts are still reused and are not silently overwritten.

This is a targeted repair of chunk stitching. It is not forced acoustic alignment. [WhisperX](https://arxiv.org/abs/2303.00747) describes a broader VAD and forced-alignment approach to timestamp accuracy; that remains a separate candidate to evaluate against labelled audio. Repairing omissions here does not prove word-level timing accuracy.

## Validation and artifacts

- **407 tests across 48 files passed.** Both TypeScript projects, ESLint and the production Electron/Vite build passed.
- New real-corpus regressions cover all three recovered passages, the coherent join, unchanged surrounding words, immutable input, missing/invalid anchors, malformed timing, audio assembly, failure fallback, cancellation, progress and temporary-file cleanup.
- Six production-rendered comparison files decoded completely, with no detected full-frame black intervals. Before/after frames were inspected for all three source intervals; previously absent captions are visible in the updated frames.

[Source-audio re-decodes](../../.tmp/quality-corpus/transcript-seams/audio-redecode.json), [anchored replay report](../../.tmp/quality-corpus/transcript-seams/repair-report.json), [render/decode results](../../.tmp/quality-corpus/transcript-seams/render-review.json), [model revision and artifact hashes](../../.tmp/quality-corpus/transcript-seams/provenance.json), [bounded regression fixtures](transcript-seam-fixtures.json).

The local faster-whisper large-v3 worker used CUDA float16, beam size 5, VAD and word timestamps. Its within-file previous-text conditioning was disabled. Production code still uses the configured transcription endpoint; the local bridge supplied that endpoint for this experiment without a Platform API key. No new transcription provider was installed in Settings.

## Limits

These are four joins in two English recordings, and six exports of three reused intervals. They do not establish overall word error rate, acoustic cut accuracy, multilingual reliability or OpusClip parity. The detector can miss short omissions and shared ASR mistakes. A short decode can also introduce a different mistake; matching anchors protect surrounding words but cannot prove the central text correct. In the initial experiment, an unnecessary short decode repeated “and”; the disagreement gate prevents applying that patch to the coherent join.

Native preview was not changed or reverified in this pass; production caption rendering was exercised. Source-ASR wording, punctuation, dense captions, speaker association and compelling openings remain quality gaps. Existing cached projects need an explicit transcript regeneration path to benefit; preserving user transcript edits is necessary before adding such a migration.
