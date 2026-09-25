# Editorial ranking

Enable **Review and rank complete stories (beta)** on clip setup to use the new ranking. It is opt-in while quality evaluation is pending. Existing projects keep their saved clips until regenerated.

## The decision sequence

1. Keep the existing discovery, boundary repair and visual-payoff checks. Freeze the surviving candidate pool, transcript, source hash and previous score/overlap order before applying the new review.
2. Review candidates with one common rubric, regardless of whether speech or visual discovery found them. API requests contain up to four candidates; ChatGPT requests contain up to two so their eight images stay within the adapter's ten-image limit. Supply retained original ASR speech, omitted speech within twelve seconds of the selection, actual kept source intervals and four sampled source frames per candidate. Generated headlines, hook titles, previous scores and discovery route are withheld from the reviewer.
3. Assess opening interest, clarity, value, payoff and explicit audience fit on anchored 0–4 scales. Value includes useful insight, entertainment and meaningful demonstration. The provisional index weights these 20/25/20/25/10; unspecified audience fit is omitted from the denominator. These weights are a policy to test, not a learned predictor of views.
4. Exclude concretely grounded incomplete or misleading selections. A hard rejection needs a meaningful exact selected speech excerpt and a concern; changed-meaning rejection also needs an excerpt from the omitted context. A visual-only result absent from sparse stills remains uncertain. Uncertain, truncated, malformed or failed reviews have no numeric score and follow reviewed candidates.
5. Compare reviewed takeaways for substantially repeated ideas. A shared topic alone is not a duplicate. Keep the strongest reviewed selection first, move repeated alternatives after distinct reviewed ideas, and retain them for the user. Overlap removal compares the actual retained footage, including cuts and tightening. It no longer uses an outer interval that may contain discarded footage.

The editor shows the reason, dimension scores, concerns and cited source evidence. A score is a model assessment of the source selection. It does not mean the final crop, captions, audio or export have been verified. Changing retained speech, trims, cuts, tightening, restored pauses or caption text invalidates the displayed score when those edits change the assessed selection. Layout/title changes still need separate visual checking. Relinking a source clears saved assessments.

## Reliability and costs

At most 44 candidates receive review: up to eleven logical review calls through the API or twenty-two through ChatGPT, plus one repeated-idea call. The setup screen displays the worst-case total of twenty-three additional calls. Provider retries may add attempts. Candidates outside the budget remain visible as needing review. Existing discovery, transcription, visual repair and framing are additional work. The new stage adds no model dependency, hosted service or background publishing.

Each request has bounded text and image input. Frame extraction uses the existing media queue. Authorization, billing, exhausted rate limits, subscription limits and cancellation stop the run. Other review failures retain candidates as needing review. A failed idea-comparison pass retains score order with an explicit notice. If every candidate is rejected, the report is saved and prior user clips remain intact.

Reports carry the analysis generation identity. If an attempt fails while retaining older clips, the setup and results screens label its report as a later attempt; its rejection counts and ordering claims are not attributed to those older clips. Enabling the beta does not raise the configured daily request allowance.

Reports retain every assessment, rejection/uncertainty count, overlap suppression count and request count. They also retain two frozen ranking arms and the shared input transcript/video metadata. Saving fewer recommendations cannot silently improve the benchmark denominator. A source file changed during review invalidates the snapshot. The report is not a durable checkpoint for resuming individual requests after a crash, and repeated generation can incur fresh review costs.

## Baseline and verification

The [frozen legacy recipe](../benchmarks/editorial-ranking/legacy-recipe.json) records the old score blend and overlap policy before this integration. Each new run saves that policy's output on the same candidate pool alongside the new order. The [benchmark workflow](quality-benchmark.md) can export and render both frozen arms locally without model calls. Use identical source, candidate pool and render settings to isolate ranking; evaluate discovery and finished automatic layouts separately.

Tests cover evidence validation, incomplete/misleading gates, quiet visual content, explicit/unspecified audiences, missing responses, failed sampling, provider limits, cancellation, request bounds, changed sources, semantic deferral, retained-footage overlap, snapshot isolation and stale edit detection. The native smoke walk checks the ranking control, reviewed/review-needed/legacy states, and stale-score handling after a cut and undo. CLI integration tests render real local videos and retain failed exports in comparison coverage.

A [bounded live ChatGPT smoke check](provider-smoke.md#recorded-check-25-september-2026) exercised a real `gpt-5.6-luna` editorial response on public silent footage. It returned valid uncertainty and no overall score; the report preserves that outcome. The API provider remains untested live because no credential was available. Independent human ratings have not been collected. Model judgments can still be wrong, and four source frames cannot establish continuous motion, complete visual recall or final export quality. The existing discovery pool can omit strong moments before this review ever sees them. Use untouched sources and blind publishability/repair-time reviews before claiming improved quality or an advantage over OpusClip.
