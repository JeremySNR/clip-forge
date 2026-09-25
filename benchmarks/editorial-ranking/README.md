# Fixed-pool editorial ranking experiment

Status: **the legacy recipe is frozen; no human quality result is recorded here.**

`legacy-recipe.json` was captured from the working tree before adding editorial reranking. It records the exact legacy score blend and final overlap-selection functions, source-file hashes, the Git base, and the presence of uncommitted changes. Do not replace this recipe when tuning a challenger. Introduce a new experiment version instead.

The question is whether a new ordering of the **same candidate pool** puts more complete, useful, distinct clips near the top and reduces correction work. This is narrower than whether a complete new pipeline beats a historical release or OpusClip. Discovery misses, candidates filtered by earlier repair/review, and different model proposal responses are outside this comparison.

Freeze the candidate pool before editorial selection. Preserve complete clip snapshots, including IDs, original insertion order, provisional scores, source boundaries, cut/protection ranges, framing state and captions. Preserve the transcript and source identity too: saving a clip's start/end alone cannot reproduce its rendered result after caption or framing edits.

Use the recorded legacy rule to obtain the baseline ordering. For the challenger, use the editorial decisions made from that exact pool. Both arms must use the same source bytes, frozen transcript, rendering inputs and top-five budget. Later user edits or automatic framing must not silently replace saved benchmark inputs. Exports remain unavailable until actual videos have been rendered from those inputs.

Before comparing outputs, declare the source groups, audience instructions, top-K budget, clip-length constraint, code/model/configuration revisions, primary metric and failure policy. Rank-only selection does not establish discovery recall or a reliable probability of virality. Do not tune from held-out review labels.

At least two independent editors should review anonymized exports and then compare their source context. Use the [quality benchmark](../../docs/quality-benchmark.md) for publishable/repairable/reject decisions, severe defects, measured repair seconds, missing-output coverage and source-group summaries. Do not fabricate labels to turn a saved snapshot into a completed experiment.

The primary comparison is publishable clips per requested top-five slot, accompanied by source-level results, source-fidelity defects, diversity and actual repair time. Report fallback/unreviewed cases and empty slots. Keep per-reviewed-clip publishability alongside full-slot yield so abstaining from difficult cases cannot conceal lost coverage.
