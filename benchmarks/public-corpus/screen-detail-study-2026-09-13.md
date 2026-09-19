# Screen overview and detail views — 13 September 2026

ClipForge now keeps a complete source overview above a larger view of the UI or diagram being discussed. Captions occupy the space between those views. This improves several real screen-demo moments that were preserved but unreadable in the previous full-frame portrait fit.

[Play four before/after comparisons](../../.tmp/quality-corpus/screen-detail-v3/index.html). [Warning and translation controls](../../.tmp/quality-corpus/screen-detail-v3/renders/narrated-screen-demo/rank-1.mp4).

## Observed results

| Moment | Final behavior | Limitation |
| --- | --- | --- |
| Translation warning and controls | One stable detail rectangle throughout the 17.12-second clip; UI content is **2.883×** its previous linear size on a 360×640 canvas. The warning, translation source and paragraph controls remain visible in inspected frames. | Fine explanatory text still depends on source resolution. |
| Saved draft | Full-frame editor context followed by a detail view of the draft entry; **2.397×** enlargement during the final portion of the 14.28-second clip. | The earlier editor remains small. |
| Published article | Full-frame fit retained in the final 13.52-second clip. | Still too small for comfortable phone reading; the proposed broad article crop did not help enough. |
| Uncanny-valley explanation | Graph detail before and after the speaker shot; **1.970×** enlargement of the graph in the 18.24-second clip. The middle section retains the speaker crop. | The curve is clearer; fine axis labels remain limited. |

These gains describe geometric enlargement, not measured OCR accuracy or audience comprehension. Final comparison sheets were inspected for all four moments. Phone-size warning/article frames from the second iteration exposed the weak article enlargement. Review did not include independent listening or a complete real-time editorial assessment.

## Method and changes made from evidence

The planner receives nine source frames at up to 1024 pixels wide, their timestamps and the interval's narration. It can propose up to three stable intervals, each containing either a detail rectangle or full-frame fit. Inclusive frame indices must partition all nine samples without gaps or overlaps; interval boundaries lie halfway between adjacent samples. Rectangles receive source-space validation, padding and outward even-pixel rounding.

Each detail proposal is checked against seven additional source frames using the same FFmpeg layout builder as the production renderer. The reviewer sees the source reference and equal-size before/after portrait canvases, plus narration for that interval. It must accept the composition and identify visible labels. A deterministic **1.8× minimum enlargement** rejects details that use space without a sufficient size gain. This floor is provisional, and model-reported labels are not independent OCR evidence. Rejected proposals retain full-frame fit.

Three runs changed the implementation:

1. The first revealed a mismatch between inclusive model frame intervals and the parser. The interval contract and validator now agree.
2. The second supplied narration to the verifier so it can assess the discussed control rather than requiring every incidental neighboring control in the detail view. Its broad article detail was still visibly weak on a phone-size canvas.
3. The final run added the enlargement floor and asked for focused controls instead of broad editor columns. It retained useful warning, draft and graph views, and rejected the article detail.

The overview shows a blue outline identifying the detail rectangle. Its height is 30% of the output; the detail starts at 46% and has 46% available height. Captions use a 38% vertical anchor between the views. Caption events split at layout boundaries so a word spanning a layout change moves correctly without losing its highlight.

## Preview and validation

The native preview uses one video decoder: a canvas draws the overview from the same video frame while the video element displays the masked detail region. This avoids maintaining two independent playback clocks. Manual Fit clears the detail mask and hides the overview. Paused resize updates the canvas and geometry.

- **397 tests across 46 files passed**, both TypeScript projects passed, ESLint passed, and the production Electron/Vite build passed.
- All **12 exports across three runs** decoded completely with no detected full-frame black intervals. These reuse four selected moments, not twelve independent examples.
- Native warning-clip checks passed at three source times, during actual playback, after paused resize, and after a manual Fit override.
- Native graph checks verified detail → speaker crop → detail at three source times, with no renderer errors.

[Final metrics](../../.tmp/quality-corpus/screen-detail-v3/metrics.json), [run metadata](../../.tmp/quality-corpus/screen-detail-v3/run.json), [frame/decode review](../../.tmp/quality-corpus/screen-detail-v3/review.json), [runner hashes and model provenance](../../.tmp/quality-corpus/screen-detail-v3/provenance.json), [warning preview checks](../../.tmp/quality-corpus/screen-detail-v3-preview-check/result.json), [graph preview checks](../../.tmp/quality-corpus/screen-detail-graph-v3-preview-check/result.json).

## Remaining quality gaps

The comparisons reuse v8 moments, cached local Whisper transcripts, cuts and rankings. This is a composition experiment, not a fresh test of selection quality. The experimental signed-in Codex CLI bridge provided model calls without a Platform API key; its API-shaped model name is ignored and the CLI default is used. It remains a local helper, not a Settings provider.

Sparse frames can miss moving controls or brief events. Dense articles remain weak. Captions still contain source-ASR mistakes and some openings depend on missing context. Independent speaker labels, audio-grounded transcription evaluation, held-out sources, complete motion/audio review and matched OpusClip comparisons are still needed. These results do not establish OpusClip parity.
