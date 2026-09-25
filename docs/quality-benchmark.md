# Comparing methods by output quality

The benchmark runner accepts saved outputs from any model or provider. It makes no API calls. Its metrics are diagnostics, not a claim that a clip is engaging or that one model beats OpusClip.

Run with Node 20+ and the project's installed dependencies:

The npm entry point is `npm run quality:benchmark -- compare <manifest.json> <new-output-dir>`. The direct Node commands below also work when the machine's npm launcher is unavailable.

```powershell
node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.node.json scripts/quality-benchmark.ts export-project "C:/path/to/project.json" podcast-01 ".tmp/baseline.json"
node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.node.json scripts/quality-benchmark.ts compare "benchmarks/manifest.json" ".tmp/experiment-01"
```

Output paths must be new. The exporter reads the actual video to calculate its SHA-256. It exports saved word timings and ranked clip ranges. Current Cutawan projects do **not** contain diarized speaker identities, so this adapter leaves speaker and visual-target metrics unavailable rather than inferring identity from horizontal crop positions. The adapter also preserves optional source-discovery reports (status, sample gaps, failures and request counts) and each ranked clip's transcript/visual discovery origin in `discovery[caseId]`; legacy origins remain `unknown`. `compare` carries these as self-reported provenance alongside each case, never as human labels or quality scores. This enables comparing a transcript baseline against the source-scan revision without hiding partial discovery. Record the model names, settings, code revision, manual edits, and runtime for any controlled baseline; old projects do not preserve those details.

## Compare editorial ranking on a frozen candidate pool

Projects generated with editorial review store a separate snapshot taken after the existing visual review/repair filters and before final overlap removal. The snapshot preserves the source hash, video metadata, transcript, instructions, model/provider, every candidate's complete clip state, the legacy baseline order, and the editorial order. Later caption edits, trims, tracking and B-roll changes to the live project do not replace these saved benchmark inputs. `export-project` exports the current live clip list in editorial order when the project has a ranking report; use `export-ranking` for a controlled frozen comparison.

```sh
npm run quality:benchmark -- export-ranking /path/to/project.json demo-01 .tmp/ranking-frozen
npm run quality:benchmark -- render-ranking .tmp/ranking-frozen .tmp/ranking-renders 5
```

`export-ranking` creates a new directory with `snapshot.json`, `baseline.json` and `editorial.json`. The snapshot has a SHA-256 checksum, exact candidate IDs/order/ranges/edits, frozen transcript and both selected clip arrays. The exporter verifies the original source bytes and records hashes for enabled external B-roll assets. The two arms may differ in editorial assessments and ordering, but their candidate edit inputs must match. It refuses legacy projects that have no snapshot: today's outputs cannot reconstruct a historical candidate pool.

`render-ranking` verifies the snapshot checksum, source bytes and B-roll asset inventory, then renders the original top-K slots from both arms locally, with no API calls. It uses the captured clip state, CPU encoding, standard quality, bundled fonts and no branding. It does not run additional tracking or generate B-roll. This keeps a ranking experiment controlled; snapshots with pending framing are rendered as captured and are not an evaluation of later automatic framing. Keep the same environment/code revision for both arms and record the environment if comparing across runs.

The render directory contains prediction files with explicit render ranks, `snapshot.json`, videos, and `render-report.json` recording rendered hashes, failures, unfilled slots, renderer-source hash and settings. Failed exports stay in the predictions as missing video paths, so `compare` retains them in its full-slot ledger. A model's successful review is never converted into a human `declaredReady` label.

Add the rendered `baseline.json` and `editorial.json` as two runs in a normal benchmark manifest, using **independently annotated** references for the same source and the same `topK`. Run `compare`, collect blind reviews, then `summarize-review`. The tool does not manufacture references, human ratings or measured quality improvements. `ranking[caseId]` and the comparison metrics retain the recipe, snapshot checksum, candidate IDs, output ordering and review coverage as model provenance.

The [fixed legacy recipe and experiment protocol](../benchmarks/editorial-ranking/README.md) explain the scope. Both arms share current upstream discovery/repair results. This isolates selection/ranking; it does **not** compare discovery recall against an old app release or establish superiority to OpusClip.

## Manifest and result contract

Paths in a manifest are relative to the manifest. Render paths are relative to the prediction file. All times are absolute seconds in the original source, before tightening or edits.

```json
{
  "schemaVersion": 1,
  "topK": 5,
  "minimumReviewers": 2,
  "iouThreshold": 0.5,
  "cases": [
    {"id": "podcast-01", "split": "test", "creatorGroup": "creator-a", "recordingGroup": "studio-a", "tags": ["overlap", "return-after-slides"], "source": "media/podcast.mp4", "reference": "labels/podcast-01.json"}
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
  "renders": [{"caseId": "podcast-01", "rank": 1, "path": "renders/clip-01.mp4", "declaredReady": true}]
}
```

Omit an unavailable stage. An empty array means the stage ran and returned nothing. Annotate **all** speech for word/speaker scoring; the visual-target metric alone permits partially labelled spans. Keep word tokens chronological and use the same word segmentation for every system. Map model cluster IDs to canonical reference speaker IDs consistently across the full source before scoring; do not remap per turn to hide identity switches. Include overlap and off-screen speech in audio speaker labels. In visual labels, multiple acceptable targets are allowed in the reference; each prediction must choose one. `[null]` means an intentional wide/fit shot. Visual target spans cannot overlap.

Every run must include every case; failures cannot be hidden by dropping hard footage. Missing stage metrics remain `null`. Check coverage before comparing runs. Optional `source` paths are hashed against the labels; predicted hashes and durations must also match. Hashes establish matching declared inputs, not proof that a provider actually processed them.

Cases with the same source hash, `creatorGroup`, or `recordingGroup` cannot cross development/test splits. Group IDs are stable, trimmed, case-sensitive strings; group related recordings conservatively. Missing groups remain accepted for old manifests, but emit an explicit warning that creator-independent holdout separation is **not verified**. Different encodings/excerpts of a recording have different hashes: give them the same recording group. A `test` label alone does not establish that footage is untouched.

`topK` defaults to 5 (maximum 100). `minimumReviewers` defaults to 2 and cannot be less than 2. Each render's `rank` is a positive 1-based position in that case's `highlights` array. Legacy render lists without ranks use per-case list order. Prefer explicit ranks for new experiments; duplicate ranks or ranks beyond the declared candidate list are errors. Only the first K renders enter the review. `declaredReady` is optional: set it only when the system actually labelled that exact export Ready; omitting it does not guess readiness.

Missing render files are logged in `metrics.json` and retained as missing in the coverage ledger. An unavailable highlight stage (omitted `highlights`) leaves unresolved output slots; `highlights: []` explicitly records that the run returned nothing. Omitted stage data cannot become a zero-error or successful result.

## What the runner measures

- **Transcription:** word error rate, insertions/deletions/substitutions. Unicode normalization and punctuation removal are fixed across runs. WER is undefined for a reference with no words, while hallucinated insertion counts remain visible. For languages without word spacing, establish a shared tokenization protocol first.
- **Caption timing:** median and 95th-percentile absolute start/end errors on correctly aligned words, alongside matched-word coverage. A small error on a tiny matched subset is not good alignment. Large cases above 25 million alignment cells must be split.
- **Diarization:** exact interval integration, zero collar, overlap included, with missed, false-alarm and confused speaker-seconds. Silence false alarms count. This is not comparable to published DER numbers using different collars or overlap exclusions.
- **Visible speaker choice:** wrong-target time and missing-decision time on labelled spans. This does not measure headroom, crop jitter, subject clipping, or aesthetic composition; inspect renders for those.
- **Highlight retrieval:** precision and recall at K against distinct editor-selected moments using interval IoU and maximum one-to-one matching. Duplicate clips cannot inflate recall. `returnedFraction` is returned/K and `matchedPerRequestedSlot` is matched/K; returning one excellent clip does not masquerade as filling a five-clip budget. These are reference-agreement metrics, not virality predictions or a complete definition of editorial quality.
- **Cost and runtime:** supplied measurements, never estimated from model names.

`metrics.json` retains individual cases, splits and tags. There is deliberately no composite leaderboard that could conceal a severe speaker or caption failure behind a better text score.

## Blind review and aggregation

Every comparison produces:

- `metrics.json`: objective metrics, split integrity and missing-render warnings.
- `review.html` and anonymously named video copies: the reviewer package. When the manifest supplies original media, it also copies an anonymized source video per case and opens it at the chosen interval for context checking.
- `private-key.json`: the legacy anonymous-render mapping, retained for existing consumers.
- `review-index.json`: the version 2 coordinator ledger, including **every run × case × top-K slot**.
- `review-coverage.json`: a summary with no ratings yet, making missing renders, short output lists, and unresolved slots visible immediately.

Keep `metrics.json`, `private-key.json`, `review-index.json`, and summary files away from reviewers until their submissions are frozen. Share only `review.html` and its referenced anonymous videos. Copying full source media can use considerable disk space. Random names provide practical blinding, not proof: watermarks, styling, captions and product branding may reveal a system. Use matched styling to isolate selection/composition algorithms, and a separate comparison of each product's best default output. Do not remove a watermark if doing so violates the provider's terms.

At least two people independently review each playable clip. In the form they select **publishable as shown**, **keep but repair**, or **reject**, mark every severe defect, rate the dimensions, and record timestamped notes. The Overall dimension is required; others can be unassessed/inapplicable. Inspect the source after the first standalone viewing, then mark whether the source comparison occurred. Source-comparison coverage is reported separately: an export-only viewing cannot establish preserved meaning.

Repair seconds must be **measured**, not estimated. Time editing and checking an accepted clip on a copy. Publishable clips may have 0 seconds after checking; a blank field becomes `null` (unmeasured), never zero. Rejected clips have no accepted-clip repair time. The form validates contradictions, saves a local draft when browser storage permits, and downloads a versioned JSON file. Keep one final file per reviewer. Skipped videos are omitted from their submission and remain unrated in the ledger.

Aggregate frozen files with:

```sh
npm run quality:benchmark -- summarize-review .tmp/experiment-01 .tmp/review-summary.json reviewer-a.json reviewer-b.json
```

The output path must be new. The command also accepts zero or one submission to inspect partial coverage, but no clip can have complete consensus with fewer than two reviewers. It rejects ratings from another experiment, unknown/unavailable render IDs, repeated reviewer IDs, duplicate clip ratings, invalid scores, negative/estimated-text timings, and contradictory publishable/severe-defect decisions. Older version 1 rating forms lack the required decisions and timing fields and must be reviewed again; no verdict is inferred from a 1–5 score. Existing version 1 manifests and predictions remain supported.

The downloaded ratings contract is:

```json
{
  "schemaVersion": 2,
  "experimentId": "COPIED_FROM_THIS_EXPERIMENT",
  "reviewer": "reviewer-a",
  "ratings": [{
    "id": "ANONYMOUS_RENDER_ID",
    "verdict": "repairable",
    "repairSeconds": 42,
    "sourceCompared": true,
    "severeDefects": ["hidden-content"],
    "scores": {"hook": 4, "coherence": 4, "payoff": 3, "speakerChoice": null, "framing": 2, "captions": 4, "audio": 4, "overall": 3},
    "notes": "Example only: diagram labels are unreadable at 00:12."
  }]
}
```

Allowed defects are `changed-meaning`, `missing-payoff`, `wrong-speaker`, `hidden-content`, `damaged-speech`, `caption-error`, and `other`. These mark serious publishing problems, not every aesthetic preference. The example above is a schema illustration, **not collected evidence**.

## Reading the human summary

Results retain every slot and original submission, with summaries per run, split, tag and case. Read these fields together:

| Field | Meaning / denominator |
| --- | --- |
| `eligibleTopKSlots` | Number of cases × K, including empty and failed results. |
| `returned`, `missingOutputSlots`, `unknownOutputSlots` | Known returned candidates, explicitly unfilled slots, and unavailable candidate-stage data. |
| `rendered`, `missingRenders` | Existing nonempty video files versus returned candidates without a supplied render. Existence alone is not proof of decodability. |
| `rated`, `fullyReviewed` | At least one valid ballot versus at least `minimumReviewers`. |
| `reviewedReturnedCoverage`, `reviewedSlotCoverage` | Fully reviewed / known returned candidates, and fully reviewed / all K slots. |
| `publishableAmongReviewed` | Unanimously publishable clips with no severe defect / fully reviewed clips. Disagreement does not become a success. |
| `publishablePerTopKSlot` | Observed publishable / all K slots. This is conservative observed yield; unresolved reviews are not asserted to be quality failures. |
| `severeDefectClips`, `severeDefectRateAmongRated` | Clips flagged by **any** reviewer / clips rated by at least one reviewer. Adjudicate disagreements without discarding the original ballots. |
| `medianRepairSeconds`, `repairMeasurementCoverage` | Median of per-clip median measured time, only for unanimously accepted clips timed by at least the required number of reviewers; measured clips / accepted clips. |
| `sourceComparedClips` | Fully reviewed clips for which every reviewer checked the source. |
| `readyPublishableAmongReviewed`, `readyPublishablePerDeclaredSlot` | Publishable Ready clips / reviewed Ready clips, and publishable Ready clips / all declared Ready slots. Do not report the first without the second. |

`null` means an unavailable denominator or measurement. A small repair time on one measured clip is not evidence about all accepted clips. Reviewer IDs prevent duplicate-file counting, but cannot prove the reviewers are different humans or were independent; the coordinator establishes that.

`publishableYieldSourceInterval95` uses 2,000 deterministic bootstrap resamples of **whole source-hash clusters**, preserving clips and cases from the same source. It is null for fewer than two sources. Intervals are descriptive, may be unstable on small sets, and are not a head-to-head significance test. Sources from the same creator can still correlate; use sufficiently many independent creators and retain the grouped split. Do not bootstrap frames or individual clips as independent samples. Compare systems only after checking equivalent coverage and resolve missing reviews before making quality claims.

The source acquisition, annotation and launch-gate protocol is [benchmarks/holdout/README.md](../benchmarks/holdout/README.md). The nine existing public recordings are regression footage, not a newly untouched holdout. No human ratings, matched Opus exports or head-to-head win are implied by adding this runner. Actual engagement requires a publishing experiment with comparable audiences and exposure.

## First comparison sequence

1. Build a labelled pilot covering solo speakers, interviews, overlapping speech, accents, noise/music, long intros, slides, screen shares, scene cuts, occlusions and returning speakers. Keep original sources and matching OpusClip exports together. Use development footage to tune and separate held-out footage to choose.
2. Compare ASR and alignment independently: the current baseline, a stronger local recognizer plus forced alignment, and a hosted recognizer. Measure names, numbers, low-volume speech, hallucinations and caption boundaries, not just average WER.
3. Compare diarization, face tracking and audio-visual active-speaker detection independently, then the complete composition system. A face detector is not a speaker detector, and an audio diarizer does not establish which face is visible.
4. Compare transcript-only highlight selection with audio/video-aware candidate retrieval and editorial reranking. Keep the source, clip budget and render style fixed. Reject incomplete or misleading moments even if a model assigns a high engagement score.
5. Promote a replacement only after it improves blind export preference and avoids regressions on hard cases. Include full latency, memory, licensing and operational constraints in the decision.

Candidate families and source links are in `video-quality-review-2026-09-12.md`. No replacement has yet won this project's benchmark. Real footage and labels are required to make that decision.
