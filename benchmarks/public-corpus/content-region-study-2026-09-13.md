# Content-preserving enlargement — 13 September 2026

ClipForge can now fit an inspected source region intact into the output, alongside its existing speaker crop and full-frame fit. This addresses a real failure in the corpus: preserving the entire frame kept the demonstration visible but made it unnecessarily small.

[Play four before/after comparisons](../../.tmp/quality-corpus/content-region-v2/index.html). [Improved popcorn demonstration](../../.tmp/quality-corpus/content-region-v2/renders/automation-empathy-talk/rank-3.mp4).

## Results on the selected moments

| Source | Observed result | Remaining limitation |
| --- | --- | --- |
| Popcorn installation | The protected mechanism and drum reveal use source rectangle x=368, y=0, width=1162, height=1080. Their linear size is **1.652×** the previous full-frame fit in portrait. The pan, burner and drum kit remain visible in the reviewed source/output pairs. The introduction also gets a modest region enlargement. | Thin white source margins remain; the explanatory opening is weak, and the mechanism is not fully explained. |
| Gilly puzzle | The final wide reaction shot is enlarged while keeping both participants and the puzzle. The hands-on close-up remains full-frame because the puzzle and moving hands reach the source edges. | This does not make every puzzle detail readable. The main demonstration still needs a better composition. |
| Narrated screen demo | Full-frame fit retained because the source text, translation and controls span the screen. | Too small for comfortable phone reading. Needs a coordinated detail/context layout or timed guided views. |
| NASA static interview | Speaker crop retained; decorative/background monitors do not force the whole scene into a strip. | Caption placement, opening and title relevance are unchanged. |

All four final exports decoded completely; none had a detected full-frame black interval. Durations were 43.12, 20.53, 17.12 and 32.55 seconds respectively. The popcorn output measured −14.1 LUFS and −0.4 dBFS true peak; this pass did not change audio processing. Six source/export frame pairs per clip were inspected. This is frame review and technical analysis, not independent listening or a full-motion editorial rating.

## Method

Within a shot, the model first sees three unpadded original-source images plus actual face-crop comparisons. For shots needing context, it can propose one normalized rectangle. Deterministic validation rejects non-finite, reversed, out-of-source, tiny and insignificant rectangles, adds a 1.5% source margin, and expands the crop boundaries to even source pixels.

The proposed rectangle is then checked on seven frames, including additional times not used for the proposal. The verifier receives three panels: a source reference, current full-frame portrait fit, and region portrait fit. The two output canvases have identical dimensions. A region is accepted only after that comparison judges enlargement useful and essential content contained. A rejection or failed request leaves full-frame fit. This is a provisional LLM-assisted method, not a calibrated detector or proof of containment on every frame.

The first experiment accidentally compared a 480-pixel source reference with a 270-pixel region output while asking whether the region was larger. It rejected useful candidates on size grounds. That result changed the method: equal-size before/after output panels now test enlargement, with an independent source reference for containment. Original unpadded frames also prevent the comparison canvas's padding from becoming part of proposed source coordinates. Both experiment runs are retained.

The design follows the general principle of preserving important regions and fitting when a narrow crop cannot contain them, described in [Google's AutoFlip overview](https://research.google/blog/autoflip-an-open-source-framework-for-intelligent-video-reframing/). It is **not an implementation of AutoFlip**: AutoFlip's object detection/tracking and optimized camera paths differ from this sparse-frame proposal and verification method. It has not been shown superior to AutoFlip or OpusClip.

## Export, editor and pipeline behavior

- Region geometry is shared between export and preview. The renderer crops the source rectangle, then fits it intact; the preview applies a corresponding transform and mask. Removed waiting intervals remap shot timing while retaining the rectangle.
- Low-confidence speaker handling preserves an independently verified object region. It does not revert that region merely because the shot has no usable face.
- Up to eight distinct regions can produce render branches; extra regions fall back to full fit. Speaker crop commands are disabled where they could accidentally move an object crop.
- Native Electron checks passed at four source times, crossing from a region into full fit and back. Actual playback skipped the removed wait and landed inside the protected mechanism footage.
- Paused window resize recomputed the mask. Manual Fit cleared it. Automatic composition is labelled in the editor, and ineffective auto-zoom/focus controls are replaced by the appropriate automatic/manual choices.
- Explicit Product demo mode now receives composition analysis without face tracking. Like face analysis, the top candidates run eagerly and others run when opened or exported.

Final checks: **391 tests across 45 files**, both TypeScript projects, ESLint, production build and patch whitespace checks passed. New tests cover rectangle validation and outward rounding, preview geometry, manual overrides, low-detail protection, crop-command isolation, proposal verification and full pipeline orchestration for product demos and visual-payoff repairs.

## Reproducibility and limits

[Run metadata](../../.tmp/quality-corpus/content-region-v2/run.json), [frame and decode review data](../../.tmp/quality-corpus/content-region-v2/review.json), [native preview checks](../../.tmp/quality-corpus/content-region-preview-check/result.json).

Compiled runner hashes:

- First comparison: `4989034b939aafecc414560636d96773e1e5e792ee66b23441c592f0835d0968`.
- Corrected comparison: `5ae92ed41fa97ae9f0f9855e436deb78453af1eb863aa4eb9b512ddcba9d6246`.

These are **eight exports of four existing moments**, not eight independent examples. Source transcripts, cuts, captions and rankings were reused. The popcorn input is the preceding visual-story repair; the other inputs are v8 clips. Descriptive scoring fields in those experimental fixtures remain inherited; this was a composition comparison, not a fresh editorial-selection run. The existing signed-in Codex bridge supplied model calls; it ignores the API-shaped model name and uses the CLI default. No Platform API key was needed for the experiment, but the bridge is still a local helper rather than an installed Settings provider.

The strongest next composition work is a detail/context layout for screens and demonstrations that cannot fit into one readable rectangle. Broader moving-subject tests, independently labelled containment and speaker decisions, better captions/transcription, subjective listening, and matched OpusClip/audience comparisons remain necessary.
