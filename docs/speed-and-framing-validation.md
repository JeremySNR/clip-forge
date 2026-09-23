# Faster processing and steadier framing

Measured on a MacBook Air M1 (8 GB, fanless) on 22 September 2026. Sources were local copies of public podcast and interview footage used only for testing: the CC-licensed Wozniak interview from the pilot corpus, 10-minute sections of Hot Ones, Flagrant, a Huberman interview and an MKBHD review, and the three saved T3.GG projects. None of this footage is in the repository. Numbers are single-machine observations. Timings on this fanless machine varied by up to 50% between identical runs, so the transcription comparison below alternates the two paths with cool-down pauses.

The benchmark scripts are `scripts/bench-reframe.ts` (reframing speed and framing), `scripts/eval-cuts.ts` (pause-removal cut points), `scripts/render-reframe.ts` (real analysis and export of one range) and `scripts/transcribe-local.ts` (offline transcripts for those scripts).

## Clips appear before layouts finish

The pipeline used to analyse the top clips' layouts before showing any clips. It now returns once clips are scored, thumbnailed and given B-roll. The same top clips are then analysed in the background through the on-demand route, which opening a clip or exporting it already joins. Each clip card shows "Framing…" until its layout lands. A background failure leaves the clip pending, so the editor retries it on demand, and a failure no longer fails the whole run. Background work is cancelled on regenerate, delete, relink or whole-video captioning. Thumbnails are extracted four at a time instead of one at a time. Pipeline stages now log `[timing]` lines.

## Speaker tracking

| Change | Measurement |
| --- | --- |
| Detect faces every 5th frame instead of every 2nd (boxes were already interpolated and median-smoothed over 0.5 s) | 120 s of Wozniak: 95 s → 67 s. The focus path differed by more than 5% of the frame width in under 0.2% of samples. The one lost switch was 0.12 s before a camera cut. |
| Tracks hold their last box until the face is actually missed, never across a cut | Stops the stride trimming each shot's tail. Covered by unit tests. |
| Detect at half resolution between full-resolution checks (each shot start and every 2 s) while every face found is large | About 17% less time again across five sources (Wozniak 22.5 → 18.8 s, Hot Ones 23.7 → 19.2 s for 40 s). The focus path was unchanged except on MKBHD, where half resolution found an extreme close-up that full resolution misses. |
| Also try half resolution when full resolution finds no face | Catches faces that fill the frame and exceed YuNet's largest scale at full size. |

## Camera planning

`shared/cameraPath.ts` plans each shot with lookahead instead of reacting to a threshold. It holds the crop perfectly still while the face stays within ±20% of the crop width of centre, otherwise re-centres with an eased pan centred on the move. Positions are clamped to where a 9:16 crop can actually go. Framing metrics over ten 60 s ranges of four sources, against the same followed-face targets:

| Planner | Face more than a quarter crop width off-centre | 95th-percentile offset (crop widths) | Worst range | Moves per minute |
| --- | --- | --- | --- | --- |
| Previous (reactive 0.1 source-width threshold) | 2.2% of time | 0.179 | 0.26 | 0.2 |
| New, band 0.20 | 0.4% | 0.151 | 0.20 | 1.3 |

The band was chosen from a sweep of 0.12–0.25; narrower bands centre better but pan up to 4 times a minute. Visual inspection of a Flagrant range with an animated guest showed the old crop leaving his face at the frame edge while the new crop stayed centred. Seated guests got identical framing from both. This is a modest improvement, not a transformation: the previous planner was already mostly stable.

## Two-person split screen

When the same two faces share one camera shot and both speak within a 5 s window (at least 0.6 s each), that range becomes a stacked split. It lasts at least 3 s, and gaps under 1.5 s are bridged. The left person goes on top, captions sit on the seam, and each panel is framed from its own face and never extends over the other face. A split is skipped if a panel would need more than 3.2× enlargement. Long monologues keep the speaker crop. The editor has a "Split screen during conversations" switch, and screen and presenter layouts are never altered.

Inspected output: the Wozniak sofa exchange (interviewer above, Wozniak below) and three Hot Ones exchanges, each panel showing one person. Auto zoom stays off for clips that contain a split, the same rule as other overlaid layouts. Preventing zoom only during the split is future work.

## Cutting in silence

Silero VAD v5 (MIT, 2.3 MB, bundled) runs in the inference child alongside transcription. It adds 19 s for 30 minutes of audio while other work was running, and it runs once for older projects. Pause removal moves each internal cut to where detected sound actually stops and starts, and skips removals that become shorter than 0.35 s.

| Source | Word-timed cuts inside detected sound | Removed time, word-timed → voice-aware |
| --- | --- | --- |
| Flagrant (crosstalk and laughter) | 27 / 34 | 37.3 s → 10.7 s |
| Hot Ones | 27 / 40 | 31.8 s → 20.2 s |
| Huberman | 11 / 24 | 9.0 s → 4.1 s |
| MKBHD | 0 / 0 | 2.3 s → 2.3 s |
| Saved T3.GG projects (73 clips) | 1 / 8 | 4.7 s → 4.4 s |

On podcasts, 66% of the old cuts landed inside sound. Inspection showed Whisper word ends up to 0.5 s early (clipping the word's tail) and cuts through laughter or interjections the transcript never contained. Voice-aware cuts remove less time; everything they remove is detected silence. The snapped version scores zero in-speech cuts by construction, so the table measures the size of the old problem, not independent proof of the fix. Listening tests are still outstanding.

## Export

- **Layout canvas.** Each composition branch built its black canvas with a full-frame `drawbox` fill, costing 22.6 s per minute of 1080×1920 output per branch. It now blackens a 2×2 seed before padding (0.9 s), and branches process only the frames where they are visible. A Hot Ones minute with three split layouts went from 139 s to 95 s on CPU with frame-identical output (SSIM 1.000 on all 1440 frames).
- **Apple VideoToolbox.** On macOS, Auto and Hardware exports use the bundled ffmpeg's VideoToolbox encoder after a hardware-only test encode, falling back to CPU on failure. Quality levels were matched to the x264 tiers against a lossless reference: q65 ≈ CRF 23, q75 ≈ CRF 19 and q80 ≈ CRF 17, all within 0.001 SSIM. Encoding is about 5× faster than x264 medium; files are about 40% larger at equal quality. The same Hot Ones minute exports in 38.5 s. Size-targeted exports still use two-pass x264.
- **Square pixels.** Crops rounded to even widths carried a sample aspect ratio such as 404:405 into exports. Output is now marked square (`setsar=1`).

## Local transcription on Apple Silicon

On Apple Silicon, setup now also installs `mlx-whisper` and the matching MLX model. `transcribe.py` then transcribes on the GPU, using faster-whisper's Silero VAD to pick speech regions just as `vad_filter` does on the CPU. The install is optional, so a failed MLX install still leaves the CPU path. Five minutes of Huberman, alternating paths with 45 s pauses:

| Path | Runs (s) | Word difference from a large-v3-turbo reference |
| --- | --- | --- |
| CPU faster-whisper small, int8, beam 5 (current) | 59.6, 47.3, 45.3 | 5.8% |
| GPU mlx-whisper small (greedy) | 26.8, 25.5, 25.8 | 4.4% |

The reference is another model, not a human transcript. Word counts and timestamps are otherwise consistent. Existing installs pick this up when setup is re-run.

## Not done

- **Forced alignment.** Not implemented; voice-aware cuts address the most audible symptom.
- **ByteTrack-style tracking.** Not implemented: on this footage tracks already spanned whole shots, so there was no fragmentation to fix.
- **Speaker turns from audio (diarization).** Not implemented.
- **Human evaluation.** No blind comparison against OpusClip or human editors. Framing and cut metrics are proxies.
- **AI stages.** The AI stages (clip finding, visual review, layout review) were not timed here because they need a paid connection.
