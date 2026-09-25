# Visual source discovery (beta)

In **Find clips**, enable **Find visual moments (beta)** before generating or regenerating clips. This adds a source-wide sampled visual scan before transcript highlight selection. The option is off by default, saved per project, and does not apply to Caption the whole video.

The scan looks for demonstrations, visible results, reactions and visual stories that transcript selection can miss. Videos without an audio track can use this path. A silent visual clip starts without captions; an empty transcript still cannot be used to caption a whole video.

## How selection works

1. Sample eight frames in each of up to eight evenly distributed source sections. Longer recordings have larger gaps between samples.
2. Ask the configured vision model for observable actions and later results. It may return no proposals. Transcript context uses original ASR words where available; relative loudness is context, not an emotion label.
3. Inspect up to four promising neighborhoods with ten closer samples each. This fits the ChatGPT adapter's ten-image limit as well as the API route. A proposal needs distinct action/result evidence and a model judgement that the event is complete. These checks constrain a proposal; they do not establish human-rated story quality.
4. Preserve the selected event and expand any crossing spoken sentences. Reject a candidate that cannot fit the chosen length rather than cutting off its result.
5. Combine visual candidates with spoken highlights, run the existing editorial/visual review, then remove overlapping results after payoff repair. Ranking remains provisional; this increment does not calibrate scores against audience outcomes.

Visual candidates begin with full-scene fit, no invented hook title, pause removal off and auto zoom off. Their observed event is protected if tightening is subsequently enabled. Existing layout review can propose a composition. Review the action and result before exporting, especially when manually trimming or changing the crop.

## Budget, caching and recovery

The discovery stage makes at most twelve logical model calls: eight source scans and four refinements. Provider retries can add requests. Transcription, spoken highlight selection, clip review and framing are separate stages with additional costs. Existing provider limits and cancellation remain in force; this is not a whole-project spending cap.

Completed scans are cached under the project directory. The key includes the full source SHA-256, original speech and energy context, model/provider identity, instructions, clip-length limit, prompt/configuration version and sampling budget. Cache writes are atomic and malformed entries are ignored. Source replacement during a scan is rejected. A complete empty scan is cacheable; a partial or failed scan is not, so regenerating retries failed coverage. Relinking the source clears the saved report.

The report is saved even when a scan yields no usable clips. Open its details on the project setup or clip list to see successful/failed sections, sample gaps, refinement counts and proposals rejected at sentence boundaries. `complete` means every planned scan/refinement request succeeded. It does not mean every source event was observed or that a clip is ready to publish. Authentication/subscription-limit errors and cancellation stop the run rather than becoming a successful empty result.

## Scope and verification

This is sparse still-frame discovery with speech context. It does not classify laughter, applause or music, follow continuous motion, or exhaustively inspect long sources. Requested frame times can be up to one second later than extracted frames; reports retain that uncertainty. Brief events between samples can be missed, and model evidence can be wrong. The UI exposes the largest sample gap and visual origin of proposed clips.

Regression coverage includes bounded sampling, invalid responses, event evidence, cancellation, partial failures, cache invalidation, source changes, speech boundaries and final overlap removal. Real FFmpeg tests exercise extraction through a single-slot media queue and a silent candidate through portrait export and full decode validation. Model responses in these tests are scripted. The isolated Electron smoke walk verifies the opt-in control without making model calls.

Use the [quality benchmark](quality-benchmark.md) to compare an identical transcript baseline with discovery enabled. The project exporter carries discovery origin and coverage reports into the comparison. Freeze inputs/settings, export ranked clips from both runs, and collect independent blind ratings using the [holdout protocol](../benchmarks/holdout/README.md). A [bounded live ChatGPT smoke check](provider-smoke.md#recorded-check-25-september-2026) completed the eight-frame source scan and ten-frame refinement on public silent footage, returning one visual candidate. The API provider remains untested live because no credential was available. No untouched human-labelled corpus, audience-retention experiment or matched OpusClip comparison has been completed by this implementation.
