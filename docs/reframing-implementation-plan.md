# Reframing implementation plan

Date: 23 September 2026. Follows [the reframing review](reframing-review-2026-09-23.md). Already shipped on this branch:

- local style triage (logs only);
- webcam panels found from pixels;
- offline speaker-cut planning;
- blurred fill for camera footage;
- webcam-panel routing.

This plan covers what remains, in dependency order. Effort estimates assume one engineer and exclude review cycles.

Every phase ships only when these gates pass:

- the full test suite, type checking and lint;
- a before/after run on the evaluation set from phase 0;
- a preview/export parity check for any geometry change.

Existing projects must render exactly as before until a clip is re-analysed.

## Phase 0: evaluation set and metrics (2–3 days, needed before the others)

Nothing below can be tuned without real footage. The corpus hosts are blocked from the build environment, so this runs on your machine.

- **Label set.** About 40 windows of 20–60 s from your own footage:
  - T3.GG screen + webcam;
  - studio podcasts with two or three people;
  - Zoom/Riverside calls;
  - a solo talking head;
  - a wide panel;
  - a no-face demo;
  - a clip that switches between screen and camera.
  
  One JSON file per source (`benchmarks/framing-labels/*.json`) records, per window, the style and, where it matters, who is speaking in each second. Speakers are identified by rough horizontal position; labelling takes about 2 minutes per window.
- **`scripts/eval-framing.ts`.** Runs the real analysis on each window and reports:
  - triage style against the label (confusion matrix);
  - share of speech time on the right person;
  - cuts per minute and the shortest shot;
  - share of frames with the followed face fully in the crop and out of the caption zone;
  - headroom error (eye line against a third of the frame);
  - share of the canvas filled by source pixels;
  - crop jerk;
  - seconds per clip.
  
  It also writes a contact sheet of output frames per window for eyeballing. It reuses `bench-reframe.ts` caching so planner changes re-run in seconds.
- **Baseline.** Commit the numbers for the current branch as the reference each later phase must beat, the same way the existing validation docs record results.

## Phase 1: vertical position and zoom for the crop (1.5–2 weeks, largest quality gain)

The problem: the crop is always full source height, and only x moves. That means Cutawan cannot:

- tighten on a small face (panels, wide podcast shots);
- keep the eye line near the upper third;
- isolate one person in a group.

**Approach: extend the existing zoom stage rather than rewriting the crop.** Export and preview already share a per-frame zoom:

- export: the `perspective` window in `render.ts` `zoomGraph`;
- preview: a CSS scale in `previewVideo.ts`, driven by `zoomAt`;
- anchor: fixed at 42% from the top.

A per-shot framing zoom and a vertical anchor slot into that stage. The x crop stays as it is.

1. **Data (additive, old projects unaffected).** `FocusKeyframe` gains optional `z` (framing zoom, ≥ 1; 1 = today's full-height crop) and `y` (face centre in source height, 0..1). Clips without them render byte-identically; a regression test pins the old filter graph string. Bump `reframeAnalysis.version` to 3 only for new analyses. "Retry automatic layout" upgrades older clips on request.
2. **Planning (`shared/cameraPath.ts`, `faces.ts`).**
   - `refineSpeakerSwitches` already knows the followed track per frame. Use it to carry that track's box (ASD tracks keep `boxes`).
   - Per hold in `planShot`: choose `z` so the followed face is about 25% of output height, and `y` from the median face centre.
   - Hold both constant within a hold, so they move only where x already cuts or pans. The camera stays locked off.
   - Limits:
     - total enlargement from source pixels at most 2.4× (the split-screen panels already use 2.5×). A 1080p source is at 1.78× before zoom, so its `z` tops out at about 1.35; 4K has room up to the cap;
     - hard cap `z ≤ 1.6`;
     - no framing zoom on fit or composition shots.
   - `lowDetailShotRanges` then measures face pixels *after* the allowed zoom, so wide panels get a tight speaker crop instead of falling back to fit when the source has the resolution.
3. **One shared camera-window function.** `cameraWindowAt(plan, t)` in `shared/previewFrame.ts` returns `{ z, top }`:
   - `z` = framing zoom × auto-zoom punch/creep;
   - `top` = clamp(face y − 0.36 / z, 0, 1 − 1 / z), so the face sits about 36% down the output.
   
   Export compiles the same pieces into the `perspective` expressions; framing values are piecewise and snap at cuts via the existing `piecewiseExpression` / sendcmd path. Preview applies `translate + scale` from the same numbers. This also fixes auto zoom clipping heads, because the zoom origin now follows the face.
4. **Tests.**
   - Planner unit tests: face size to `z`, upscale caps, cut snapping, no-zoom on fit shots.
   - An ffmpeg parity test that renders a marker at a known face position and checks it lands where `cameraWindowAt` predicts, following `presenterRender.test.ts`.
   - Old-clip graph identity.
5. **Editor (small).** A "Framing: Wide / Normal / Tight" choice scales the target face size. The manual slider keeps `z = 1`.

Done when, on the phase 0 set:

- headroom error and small-face failures drop;
- the speaker stays fully in the crop;
- the panel and wide-podcast windows show one person instead of a group.

## Phase 2: per-shot routing, and the triage makes decisions (1 week)

The problem: one clip gets one route. A webinar clip that switches between slides and the speaker gets either speaker tracking throughout or screen handling throughout. Talking heads pay for LR-ASD even with one face in frame.

1. **Shot list first.** Scene cuts come from the ASD pass (camera) or `screenTransitions` (screen). Run the cheap local transitions pass for every clip before routing, and triage each shot:
   - at least two frame pairs per shot, at most 12 per clip;
   - `persistentPresenterInset` per shot for panels.
2. **Route per shot** into `visualLayout.shots`:
   - `screen-with-presenter`: presenter composition, with pixel panel bounds;
   - `screen`: fit or the existing overview/detail;
   - camera styles: crop with speaker tracking.
   
   The ASD pass runs only over the camera shots' time ranges. The existing 48-shot and 8-branch caps still apply; beyond them, fit.
3. **Single-face shortcut.** When every camera shot has one face track, skip the crop, MFCC and LR-ASD scoring. This needs an `analyzeClipASD({ score: false })` option; detection and tracking still run. Talking heads should get noticeably faster; measure it in phase 0 timing.
4. **Offline screens.** Confident `screen` with no faces skips face work entirely.
5. **Enable decisions only where phase 0 shows the triage is right.** Styles below about 90% agreement stay log-only and use today's path.

Done when mixed clips get the right layout per shot, and talking-head analysis time drops with the same framing metrics.

## Phase 3: video-call gallery layouts (1 week)

The problem: Zoom, Riverside and StreamYard recordings are tiles. A speaker crop centred on one tile often shows slices of the neighbouring tiles, and a stacked split can cut through tile borders.

1. **Tile geometry.** Extend triage so a gallery shot returns tile rectangles from the still dividers (1×2, 2×1, 2×2, 1+2). Tiles must persist across the shot's samples, like the webcam panel.
2. **Follow the active tile.** Clamp the speaker crop, including phase 1 zoom, inside the active speaker's tile, so the crop never shows a neighbour. Switching uses the same refined speaker cuts, keyed by tile.
3. **Exchanges.** Stack the two active tiles using the existing `speakers` composition, with tile rectangles as sources. `validSpeakerComposition` accepts tile-sourced layers unchanged; allow up to four layers for a 2×2 "everyone" view at clip openings.
4. **Tests.** Synthetic two- and four-tile ffmpeg sources: divider detection, crops staying inside tiles, stacked tiles.

## Phase 4: overview + speaker for groups (3–4 days)

When phase 1 cannot make a sharp close-up (small faces at the enlargement cap), show the wide shot in the top third and the speaker close-up below, instead of a plain blurred fit.

- **A new `Composition` preset `overview-speaker`.** Layer 1 is the full frame, fitted. Layer 2 is a speaker panel from `speakerPanelSource`.
- **Split the shot at speaker switches.** Each sub-shot's panel is that person's rectangle. One rectangle per person keeps the number of distinct render branches at or below the number of people.
- Captions sit on the seam, as in split screen.

## Phase 5: speaker identity from audio (optional, 1–2 weeks, only if phase 0 shows speaker errors)

Run pyannote community-1 (CC-BY-4.0) diarization in the existing local Python environment, the same way local Whisper is installed. Assign each audio turn to the face track with the highest summed LR-ASD score over that turn. Feed the result as a prior into `chooseSpeakerByScores`, so a whole turn stays on one person through low-confidence frames and off-screen speech holds the shot. Ship it only if speaker accuracy on the labelled set improves without extra cuts.

## Phase 6: whole-video mode on the same route (3–4 days)

"Caption whole video" still uses 120 s focus-only windows. Point it at the phase 2 per-shot route in chunks, so long videos get:

- presenter layouts;
- splits;
- blurred fill;
- the phase 1 framing.

The chunks keep memory flat.

## Later, only if the metrics call for it

- **An L1-optimal camera path** (a linear program over x, y and z per shot, as in Grundmann et al.) to replace the band-hold planner. Worth doing only if phase 0 shows pans or jerk are a visible problem.
- **A small image-embedding classifier** as a triage tie-breaker. Worth doing only if the pixel rules miss styles on the labelled set.

## Order and dependencies

| Phase | Depends on | Effort |
| --- | --- | --- |
| 0 Evaluation set | none | 2–3 days |
| 1 Vertical position + zoom | 0 | 1.5–2 weeks |
| 2 Per-shot routing | 0 | 1 week |
| 3 Gallery layouts | 1 (tile-clamped crop), 2 | 1 week |
| 4 Overview + speaker | 1 | 3–4 days |
| 5 Diarization | 0 | 1–2 weeks, optional |
| 6 Whole-video mode | 2 | 3–4 days |

Phases 1 and 2 are independent and can run in parallel.

## Decisions needed from you

- **Footage for phase 0.** Which sources to label, and whether labelling happens on your machine with the script.
- **Tightness default for phase 1.** How close a "Normal" close-up should be: about 25% of frame height for the face is the proposed default.
- **Unreviewed offline layouts.** Whether offline, unchecked screen-and-webcam layouts are acceptable to export with a review notice, or should need a click to accept.
