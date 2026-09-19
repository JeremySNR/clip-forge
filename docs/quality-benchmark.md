# Comparing methods by output quality

The benchmark runner accepts saved outputs from any model or provider. It makes no API calls. Its metrics are diagnostics, not a claim that a clip is engaging or that one model beats OpusClip.

Run with Node 20+ and the project's installed dependencies:

The npm entry point is `npm run quality:benchmark -- compare <manifest.json> <new-output-dir>`. The direct Node commands below also work when the machine's npm launcher is unavailable.

```powershell
node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.node.json scripts/quality-benchmark.ts export-project "C:/path/to/project.json" podcast-01 ".tmp/baseline.json"
node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.node.json scripts/quality-benchmark.ts compare "benchmarks/manifest.json" ".tmp/experiment-01"
```

Output paths must be new. The exporter reads the actual video to calculate its SHA-256. It exports saved word timings and ranked clip ranges. Current ClipForge projects do **not** contain diarized speaker identities, so this adapter leaves speaker and visual-target metrics unavailable rather than inferring identity from horizontal crop positions. Record the model names, settings, code revision, manual edits, and runtime for any controlled baseline; old projects do not preserve those details.

## Manifest and result contract

Paths in a manifest are relative to the manifest. Render paths are relative to the prediction file. All times are absolute seconds in the original source, before tightening or edits.

```json
{
  "schemaVersion": 1,
  "topK": 5,
  "iouThreshold": 0.5,
  "cases": [
    {"id": "podcast-01", "split": "test", "tags": ["overlap", "return-after-slides"], "source": "media/podcast.mp4", "reference": "labels/podcast-01.json"}
  ],
  "runs": [
    {"id": "baseline", "predictions": "results/baseline.json"},
    {"id": "challenger", "predictions": "results/challenger.json"}
  ]
}
```

Each reference file is a `QualitySample` from `src/shared/qualityBenchmark.ts`. Each prediction file wraps samples in:

```json
{
  "schemaVersion": 1,
  "provenance": {"system": "provider and model", "revision": "weights hash or model version and code commit", "configuration": "settings, hardware, prompt version, preprocessing, seed if supported"},
  "cases": {
    "podcast-01": {
      "sourceSha256": "REPLACE_WITH_64_CHARACTER_SHA256_OF_SOURCE_VIDEO",
      "durationSec": 120,
      "words": [{"text": "Hello", "start": 0.2, "end": 0.7}],
      "speakers": [{"speaker": "person-a", "start": 0.2, "end": 4.8}],
      "focus": [{"targets": ["person-a"], "start": 0, "end": 5}],
      "highlights": [{"start": 10, "end": 40}],
      "runtimeSec": 35,
      "costUsd": 0.02
    }
  },
  "renders": [{"caseId": "podcast-01", "path": "renders/clip-01.mp4"}]
}
```

Omit an unavailable stage. An empty array means the stage ran and returned nothing. Annotate **all** speech for word/speaker scoring; the visual-target metric alone permits partially labelled spans. Keep word tokens chronological and use the same word segmentation for every system. Map model cluster IDs to canonical reference speaker IDs consistently across the full source before scoring; do not remap per turn to hide identity switches. Include overlap and off-screen speech in audio speaker labels. In visual labels, multiple acceptable targets are allowed in the reference; each prediction must choose one. `[null]` means an intentional wide/fit shot. Visual target spans cannot overlap.

Every run must include every case; failures cannot be hidden by dropping hard footage. Missing stage metrics remain `null`. Check coverage before comparing runs. Optional `source` paths are hashed against the labels; predicted hashes and durations must also match. Hashes establish matching declared inputs, not proof that a provider actually processed them.

## What the runner measures

- **Transcription:** word error rate, insertions/deletions/substitutions. Unicode normalization and punctuation removal are fixed across runs. WER is undefined for a reference with no words, while hallucinated insertion counts remain visible. For languages without word spacing, establish a shared tokenization protocol first.
- **Caption timing:** median and 95th-percentile absolute start/end errors on correctly aligned words, alongside matched-word coverage. A small error on a tiny matched subset is not good alignment. Large cases above 25 million alignment cells must be split.
- **Diarization:** exact interval integration, zero collar, overlap included, with missed, false-alarm and confused speaker-seconds. Silence false alarms count. This is not comparable to published DER numbers using different collars or overlap exclusions.
- **Visible speaker choice:** wrong-target time and missing-decision time on labelled spans. This does not measure headroom, crop jitter, subject clipping, or aesthetic composition; inspect renders for those.
- **Highlight retrieval:** precision and recall at K against distinct editor-selected moments using interval IoU and maximum one-to-one matching. Duplicate clips cannot inflate recall. These are reference-agreement metrics, not virality predictions or a complete definition of editorial quality.
- **Cost and runtime:** supplied measurements, never estimated from model names.

`metrics.json` retains individual cases, splits and tags. There is deliberately no composite leaderboard that could conceal a severe speaker or caption failure behind a better text score.

## Watching the final videos

When `renders` are supplied, the runner copies videos under random filenames and creates `review.html`. Reviewers rate hook, coherence, payoff, speaker choice, framing, captions, audio, and overall quality, with unusable flags and notes. Download ratings before closing the page. Keep `private-key.json` and metrics hidden until ratings are frozen. Random filenames provide practical blinding; visible watermarks, styling, titles or presenter content can still reveal a system. Use matched styling when isolating algorithms, then a separate comparison of each product's best default output.

Use at least two independent reviewers, adjudicate severe failures, and assess each exported clip before aggregating by source video. Treat clips from one source as correlated; bootstrap confidence intervals by source, not by frame. Lock the test set and protocol before tuning. Track manual repair time and rejected clips as well as preferred clips. Actual engagement requires a later publishing experiment with comparable audiences and exposure; neither model scores nor reviewer preference proves retention lift.

## First comparison sequence

1. Build a labelled pilot covering solo speakers, interviews, overlapping speech, accents, noise/music, long intros, slides, screen shares, scene cuts, occlusions and returning speakers. Keep original sources and matching OpusClip exports together. Use development footage to tune and separate held-out footage to choose.
2. Compare ASR and alignment independently: the current baseline, a stronger local recognizer plus forced alignment, and a hosted recognizer. Measure names, numbers, low-volume speech, hallucinations and caption boundaries, not just average WER.
3. Compare diarization, face tracking and audio-visual active-speaker detection independently, then the complete composition system. A face detector is not a speaker detector, and an audio diarizer does not establish which face is visible.
4. Compare transcript-only highlight selection with audio/video-aware candidate retrieval and editorial reranking. Keep the source, clip budget and render style fixed. Reject incomplete or misleading moments even if a model assigns a high engagement score.
5. Promote a replacement only after it improves blind export preference and avoids regressions on hard cases. Include full latency, memory, licensing and operational constraints in the decision.

Candidate families and source links are in `video-quality-review-2026-09-12.md`. No replacement has yet won this project's benchmark. Real footage and labels are required to make that decision.
