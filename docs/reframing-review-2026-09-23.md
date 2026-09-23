# Reframing review: choosing the right layout for each clip style

Date: 23 September 2026. Scope: the 9:16 reframing path (face tracking, active-speaker direction, camera planning, presenter/content and split layouts) and how each clip's layout is chosen. This is a code review plus literature research. It is not a measured quality result. The environment used for this review could not download the public corpus (its media hosts were blocked), so every measurement below uses synthetic fixtures.

## Summary

The basic approach is right: analyse offline, split into shots, pick a primitive per shot, plan a still-then-move camera, and verify layouts before trusting them. The weakest parts are:

1. **Deciding the style is slow, spread across five places, and mostly cloud-based.** The app decides what kind of footage a clip is only after its most expensive stages have run.
2. **The camera can only slide sideways.** It cannot zoom, tilt or set headroom, so wide shots, panels and small faces fall back to letterbox.
3. **The layout vocabulary is missing the formats creators use most after the single speaker:** remote-call galleries, groups and blurred-fill fallbacks.

This PR adds the first piece of the fix: a local style triage that runs in a few seconds with no connection. Its whole-clip style decision only logs for now, so it can be checked against real footage before it controls anything. One part does change output: screen recordings with a webcam box take the webcam bounds from pixels (section 4a). The rest of this document sets out how each style should be framed, what the research supports, and the order I would do the remaining work in.

## 1. How the current implementation decides a layout

| Where | What it decides | Cost |
| --- | --- | --- |
| `VideoType` chosen at setup (`shared/videoType.ts`) | Defaults, and whether face tracking runs at all | Free, but a single user choice covers the whole project |
| Cloud visual review, 6 frames (`visualScore.ts`) | `layout_kind` screen/camera/mixed, `preserve_context`, `allow_zoom`, webcam and content rectangles | One vision request per clip; needs a connection |
| LR-ASD at 25 fps (`asd.ts`, `faces.ts`) | Speaker vs screencast, from face coverage above or below 25% (`classifyClipContent`) | Tens of seconds per clip |
| `planSpeakerSplits`, `lowDetailShotRanges` | Two-person stacks; forcing fit when faces are small | Needs the ASD output |
| Per-shot composition review (`composition.ts`, `presenterComposition.ts`, `screenDetail.ts`) | Crop vs fit, content region, presenter panel; up to two proposals, each verified against 7 rendered frames | Several vision requests per shot |

Consequences:

- **The style is known late and only as a binary.** `ClipContentType` is `speaker | screencast`, which cannot express a gallery, a two-shot, a group or screen-plus-webcam.
- **Clip analysis is locked into the expensive stages.** Every camera clip pays for dense ASD before anything knows whether it is a single face (where ASD adds nothing) or a gallery (where tiles, not faces, are the right unit).
- **Webcam bounds come from a language model drawing boxes.** Most of the repair machinery exists to correct those boxes: repair feedback, a single contiguous panel prompt, temporal edge alerts and two attempts per shot. The two-webcam email demo is still unresolved (`docs/rejected-layout-repair.md`). Yet a webcam inset over a screen recording is visible directly in the pixels.
- **Offline use loses most of the smart layout work.** Without an API key, anything other than talking-head gets speaker tracking and binary defaults only.

## 2. Implementation problems in the reframing itself

- **The camera path is horizontal only.** `FocusKeyframe` stores `x`, and the crop is always full source height (`render.ts`, `reframeGraph`). This rules out:
  - tightening on a small face;
  - keeping eye line at about a third of the frame;
  - following vertical movement;
  - isolating one person in a panel.
  
  The 19 September checks record exactly these symptoms: the Godot panel "crops a group rather than tightly isolating a single speaker", and wide fallbacks use "relatively little of the vertical canvas".
- **The uncertain-case fallback is a letterbox.** `editDefaultsForContentType` and `protectLayoutRanges` fall back to `fit-letterbox`, which puts a small 16:9 strip in the middle of a black 9:16 frame. Commercial tools fall back to Fit with a blurred or padded fill, or to a wide shot above a close-up. AutoFlip pads with blur when required regions cannot fit.
- **Speaker switching reacts instead of planning.** `chooseSpeakerByScores` switches after a rival has spoken for 0.4 s, then holds for a 1 s cooldown. Two consequences:
  - Every cut lands at least 0.4 s after the new speaker starts, even though the analysis could look ahead.
  - A 1 s minimum between switches is short for vertical video: a two-word backchannel ("yeah, right") can pull the camera away and back.
  
  The transcript is never used to ignore backchannels. There is no audio diarization.
- **Auto zoom ignores the face.** `shared/zoom.ts` plans zoom from transcript energy and cut joins, and zooms around the crop centre. On a face framed high in the crop, a 1.16× punch can cut into the top of the head.
- **Whole-video mode drops most of the layout logic.** It analyses 120 s windows for the focus track only. There are no splits, no low-detail protection and no presenter layouts, and the last crop is held through screen-share interludes (`wholeVideo.ts`).
- **Shot cut detection is a sampled-byte threshold.** This is fine for hard cuts in podcasts. Dissolves and fast camera moves are handled with extra range logic rather than a detector trained for the job.

The camera planner itself (`shared/cameraPath.ts`) is reasonable. It uses the band-hold, lookahead and eased-pan approach that AutoFlip's stationary/pan split recommends. Its limitation is the one-axis representation, not the algorithm.

## 3. Which layout each clip style needs

This is the decision table I recommend. The styles are the ones the new triage emits. The layouts follow OpusClip's documented set (Fill, Fit, Split, Three/Four, ScreenShare, Gameplay) and AutoFlip's per-shot modes, adapted to what Cutawan already renders.

| Style | Signals | Primary layout | Fallback | Auto zoom |
| --- | --- | --- | --- | --- |
| **Single speaker** (one dominant face) | 1 face ≥ 9% frame height; live pixels | Tracked crop (x, y, scale): eye line ~⅓ from top, still-then-move path. **No ASD needed**: a single face track is enough | Blurred-fill fit if the face is too small for the source resolution | Yes, anchored on the face |
| **Two-shot** (two people, one camera) | 2 faces of similar size in one live frame | Crop that follows the active speaker, with a stacked split during quick exchanges (existing) | Split for the whole clip if ASD confidence is low | Off during splits only |
| **Group / panel** (3+ in one shot) | 3+ faces; often small | Crop on the speaker when the zoomed face stays sharp; otherwise a wide shot on top with the speaker close-up below ("overview + speaker") | Blurred-fill wide | No |
| **Gallery** (Zoom/Riverside/StreamYard tiles) | Faces separated by still, straight dividers | Tile crops taken from the divider geometry: the active tile fills the frame, and two tiles stack during exchanges. Treat tiles, not faces, as the camera units | 2×2 stack of the most active tiles | No |
| **Screen + webcam** | Mostly still pixels with a live rectangle containing a face | Content panel plus presenter panel. **Inset bounds from pixels**; the model only picks the content region and verifies | Content-first without presenter; blurred-fill | No |
| **Screen only** | Mostly still, no live face panel | Fit content; enlarged detail with an overview when text is small (existing) | Plain fit | No |
| **No face, camera** (b-roll, demos, action) | Live pixels, no faces | Saliency or object-centred crop when a subject exists; otherwise blurred-fill wide | Blurred-fill | No |
| **Mixed** (samples disagree) | Low agreement | Split into shots and decide each shot separately | Blurred-fill | No |

Two rules apply to every row:

- **Decide per shot, not per clip.** Webinars switch between slides and the speaker, and a podcast cuts between a wide shot and close-ups.
- **Where the evidence is uncertain, fall back to a filled frame, not a letterbox.**

## 4. Fast style identification: what this PR adds

`src/shared/shotStyle.ts` (pure) and `src/main/pipeline/shotTriage.ts` (sampling). Six frame pairs spread across the clip. For each pair:

- decode two frames 0.2 s apart. The gap avoids the exact duplicates that frame-rate conversion produces, which would make camera footage look still;
- run one YuNet face detection;
- point-sample luma (never averaged) at a 320-pixel long edge, so camera noise survives the downscale.

The cues are cheap and local:

- **Temporal stillness.** Screen recordings encode unchanged UI as skip blocks, so decoded pixels repeat exactly. Camera footage carries sensor and codec noise even on a tripod. A frame where most 6×6 cells repeat is screen-like.
- **A live rectangle inside a still screen.** The largest connected region of changing cells, if it is compact (0.8–45% of the frame, at least 60% filled), is a candidate inset. It becomes a webcam when a face sits inside it. The bounds come straight from the pixels, wherever the inset sits. On an encoded 1080p fixture they landed within about one cell (~2% of frame width) of the true rectangle.
- **Still dividers between faces.** A straight line that stays still between frames along 85% of its length, and is either a uniform gutter or a hard edge, separates call tiles. Ordinary walls fail because camera noise changes them.
- **Face count and size.** These separate single speaker, two-shot and group, and set `smallFaces` when the leading face is under 9% of frame height.

Samples vote on the clip's style. Below 60% agreement the clip is reported as `mixed` and recommended a safe wide fit.

Measured on local synthetic sources: 2–5 s per clip for a 1080p source, including starting the inference worker. That is against tens of seconds for dense ASD and several cloud requests for layout review. Seven new tests cover:

- insets in any corner;
- face photos inside slides;
- live regions without faces;
- single speaker, two-shot and small-faced group;
- 1×2 and 2×2 galleries;
- disagreement;
- decoded ffmpeg fixtures, including an encoded webcam inset located from pixels.

**It changes no output yet.** Setting `CUTAWAN_LAYOUT_TRIAGE=1` logs a `[layout-triage]` line beside the existing `[layout]` line for each clip, showing:

- the triage's style, recommendation, confidence and inset;
- what the current route actually chose.

`scripts/triage-styles.ts <video> --window 30` prints the triage for a whole video in windows, for labelling.

Known limits, to check on real footage before the triage is allowed to decide anything:

- **Screen threshold.** Heavily compressed static camera shots can repeat pixels. A noisy synthetic camera source scored 15–45% still cells against a 55% screen threshold. That margin is too thin to trust without real footage.
- **Moving or scrolling content.** A playing video or scrolling page inside a screen recording is a live region too. Only the face check separates it from a webcam.
- **Gallery detection needs a clean divider.** Tiles that butt together without a gutter and with similar colours will be missed and treated as a two-shot.
- **Six samples cannot see a layout change between them.** Per-shot triage should use the shot boundaries already detected.

## 4a. Follow-up: pixel webcam panels in the screen route (T3.GG layout)

T3.GG-style recordings put a fixed webcam panel in the top-right corner over a screen share. The earlier validation notes record the model's webcam boxes as the main failure: two webcams merged into one tall box, a strip of page left beside the presenter, and repeated repair calls costing 15–75 s per clip (`docs/rejected-layout-repair.md`, `docs/layout-reuse-validation.md`).

`persistentPresenterInset` now finds the panel across several samples:

- a cell must be live in two thirds of the samples, so scrolling pages and playing clips, which are live only some of the time, drop out;
- the region must be at least 80% filled and hold a face in half the samples;
- its bounds are refined to sample pixels, and each internal side must be a hard edge that is live along most of its length. That rejects a head on a still, compressed background;
- among several candidates, the one anchored to the frame edges wins, which separates the commentator's overlay from an embedded video call.

A single sample applies the same rectangle check.

For each screen shot of at least 2 s, `refineComposition` runs this on four frame pairs (`detectPresenterPanel`, local, about 1–2 s):

- the pixel panel replaces the presenter box from the editorial review and from each shot proposal;
- the content region is trimmed off the panel along the side that keeps the most content;
- the model is told where the webcam is, so it only chooses the content region;
- a webcam the model missed is still composed.

Rendered review is unchanged. The existing enlargement, presenter-size and overlap checks still decide acceptance, and a shot where no panel is found keeps the previous model path. `[presenter-panel]` log lines show each detected panel.

Not validated on real T3.GG footage here (downloads were blocked). Tests cover scrolling and embedded-video samples, an embedded second face, a head blob, content trimming and the composition flow with mocked model responses.

## 5. What the research supports

The research pass read primary sources where the network allowed: the AutoFlip source code, model cards and repository READMEs. Items marked *(summary)* could only be seen through search summaries because arXiv and several publisher sites were blocked. Check those against the PDFs before relying on the numbers.

**Camera path**

- AutoFlip chooses a mode per scene, in this order:
  - no subject: centre;
  - panning only when detection is unreliable and the scene is long;
  - steady when the subject stays within 50% of the frame;
  - otherwise tracking with a robust quartic fit per axis.
  
  It pads with blur when required regions cannot fit. [scene_camera_motion_analyzer.cc](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/examples/desktop/autoflip/quality/scene_camera_motion_analyzer.cc), [polynomial_regression_path_solver.cc](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/examples/desktop/autoflip/quality/polynomial_regression_path_solver.cc). Cutawan's band-hold planner already follows the "prefer still" rule.
- L1-optimal camera paths minimise the L1 norm of the path's first three derivatives with a linear program. This gives true tripod, constant-pan and ease segments, which viewers read as deliberate camerawork. Containment and saliency constraints are part of the program ([Grundmann et al. 2011](https://research.google.com/pubs/archive/37041.pdf)); Apple's [Cinematic-L1](https://machinelearning.apple.com/research/cinematic-l1-video-stabilization) applies it to fixed-aspect crops. This is the natural upgrade once the crop has x, y and scale. It is a small LP per axis per shot, so it should be cheap to solve, but I have not benchmarked it.
- Gandhi, Ronfard and Gleicher first generate one smooth virtual "rush" per actor or group from a single wide shot, then edit between the rushes. Their cost includes inclusion (no cut faces) and look room ([project page](https://team.inria.fr/imagine/multi-clip-video-editing-from-a-single-viewpoint/) *(summary)*). Their split-screen work ([Kumar et al. 2017](https://onlinelibrary.wiley.com/doi/10.1111/cgf.13140)) is the academic counterpart of Cutawan's stacked split. GAZED ([arXiv 2010.11886](https://arxiv.org/abs/2010.11886) *(summary)*) selects shots by dynamic programming with penalties for jump cuts, transient shots and rhythm.
  - The pattern to copy has two stages. First, plan each rush's path separately: one per speaker, group, tile or content panel. Second, choose between rushes with a dynamic program that includes switching and minimum-duration costs.

**Layouts in commercial tools** (help pages and marketing only; no disclosed algorithms)

- **OpusClip** documents Fill, Fit, Split, Three, Four, ScreenShare (screen top, speaker bottom) and Gameplay (facecam 30% top) ([layout docs](https://help.opus.pro/docs/article/layout-and-reframing) *(summary)*).
- **Descript** has an active-speaker centring beta and multicam cutaway cadences of 10 s or 30 s ([help](https://help.descript.com/hc/en-us/articles/28736507904525-Automatic-multicam)).
- **Riverside** can separate a gallery recording into speaker tracks only when the layout is fixed ([help](https://support.riverside.com/hc/en-us/articles/22758117638557-Apply-layouts-in-the-editor)). This suggests tile decomposition is a known, fragile problem.
- **ClipsAI** (MIT) reframes to the active speaker using pyannote diarization plus face positions ([repo](https://github.com/ClipsAI/clipsai)).

**Fast classification**

- **YuNet** (already bundled) has 76k parameters and runs in about 1.6 ms per frame at 320×320 on a desktop CPU ([model card](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet)).
- **Screen-content coding literature** separates screen from camera frames by strong-gradient share and few-colour histograms ([arXiv 1510.06093](https://arxiv.org/pdf/1510.06093) *(summary)*). Temporal stillness, used here, is a stronger and cheaper cue on encoded video.
- **No published detector for PiP insets or call galleries turned up.** The pixel heuristics in this PR are engineering choices without prior art to cite.
- **If the heuristics prove insufficient,** the next step is a small image embedding with a classifier head trained on a few hundred labelled Cutawan frames, not zero-shot prompts:
  - MobileCLIP2-S0: 11M-parameter image encoder; check its licence for redistribution ([repo](https://github.com/apple/ml-mobileclip));
  - SigLIP2-B: Apache-2.0, ONNX available ([weights](https://huggingface.co/onnx-community/siglip2-base-patch16-224-ONNX)).
  
  No CPU latency or accuracy on this task is published for either.
- **Shot boundaries:** TransNetV2 (MIT, 48×27 input, [repo](https://github.com/soCzech/TransNetV2)) and AutoShot ([repo](https://github.com/wentaozhu/AutoShot)) handle dissolves better than a byte threshold. CPU throughput is unmeasured.

**Speaker direction**

- **Swapping the ASD model probably buys little.** AVA-ActiveSpeaker is saturated, with published models in the 94–96 mAP range. LR-ASD is 94.45 ([repo](https://github.com/Junhua-Liao/LR-ASD)). On the harder, more modern UniTalk set the best model reaches only about 83 mAP ([arXiv 2505.21954](https://arxiv.org/abs/2505.21954) *(summary)*).
- **The larger gain is likely temporal fusion with audio diarization.** Assign each diarized turn to the face track with the highest summed ASD score, so a whole turn follows one person through low-confidence frames. pyannote community-1 (CC-BY-4.0) adds an "exclusive" one-speaker-at-a-time output that maps directly onto camera targets ([model card](https://huggingface.co/pyannote/speaker-diarization-community-1)).
- **No primary source gives numeric switching rules for short-form video.** GAZED and EditIQ penalise transient shots and model rhythm. Editing guides suggest 2–3 s minimum shots (weak evidence).

**Evaluation data**

- RetargetVid (200 videos, crop IoU against human crops; SmartVidCrop 49.9% vs AutoFlip 46.1%) ([repo](https://github.com/bmezaris/RetargetVid) *(summary)*).
- LIVE-YT VC (1,800 videos with portrait crop annotations) ([arXiv 2604.24947](https://arxiv.org/abs/2604.24947) *(summary)*).
- Neither is dominated by talking heads, so a small in-house labelled set remains necessary.

## 6. Recommended order of work

Each step should ship with measurements on real footage, following the existing validation documents.

1. **Calibrate the triage (small).** Label 30–60 windows across your own footage and the public corpus: single, two-shot, group, gallery, screen+webcam, screen, no-face. Use `scripts/triage-styles.ts` and the `[layout-triage]` logs. Tune the stillness, inset and divider thresholds per style. Report the confusion matrix. Include low-bitrate static podcasts, Zoom and Riverside recordings, scrolling screens and videos playing inside slides.
2. **Let the triage route the work (medium).**
   - **Single speaker:** skip ASD entirely and track the one face (a large speed-up on the most common style).
   - **Screen + webcam:** seed presenter bounds from pixels. The vision model only chooses the content region and verifies, which should remove most repair round-trips.
   - **Screen only:** skip face work (already the case when the cloud review says `screen`, but now possible offline).
   - **Mixed:** run the triage per detected shot.
   - Keep the rendered verification step.
3. **Give the camera y and scale (medium–large).** Extend focus keyframes to a crop rectangle, with migration of old projects. Place the eye line near a third of the frame. Zoom in on small faces within an enlargement limit tied to source resolution: a 1080p source cropped to full height is already ~1.8× enlarged at 1080×1920. Anchor auto zoom on the face. Preview and export must keep sharing one geometry function, as `focusTrack.ts` does now.
4. **Replace letterbox with blurred fill, and add the missing layouts (medium).**
   - Blurred fill as the default fallback. Letterbox stays as an explicit user choice.
   - Gallery tiles from divider geometry.
   - Overview + speaker for groups.
   - Three- and four-person stacks for panels.
   
   Tiles and panels are just more `Composition` layers; the compositor and caption-position ranges already support that.
5. **Plan speaker switches offline (medium).** Replace the reactive streak with a Viterbi/DP over (speaker rush, split) states:
   - costs from ASD scores, a switch cost and a steep penalty below about 1.5–2 s per shot;
   - ignore turns of fewer than about three transcript words;
   - cut 0.2–0.3 s before speech onset;
   - switch to the split state for sustained overlap.
   
   Measure the result against the current policy with `framingMetrics` plus the metrics below.
6. **Optional diarization fusion (large; local Python like Whisper).** Evaluate pyannote community-1 turns fused with ASD on the podcast and panel footage before bundling anything.
7. **L1 path solver (medium), once the crop has three axes.** Compare against the band-hold planner on jerk, moves per minute and off-centre share.
8. **Whole-video mode on the same route.** Run it per shot through the same triage and layout code instead of the separate 120 s focus-only path.

**Metrics to add alongside the existing framing metrics:**

- cuts per minute, and the shortest shot;
- share of speech time where the on-screen face is the labelled speaker;
- share of frames with the followed face fully inside the crop and clear of the caption and UI safe zones;
- headroom error (eye line versus a third of the frame);
- share of the canvas used by source pixels (this penalises letterboxing);
- mean crop jerk.

The first metric needs about 20 hand-labelled clips. The others are computable from the plan.

## 7. Evidence and limits of this review

- No real footage was processed in this session: the corpus hosts were blocked by the environment's network policy. Triage timings and accuracy come from synthetic ffmpeg sources (SMPTE bars, test patterns with added noise, a synthetic inset). They show the mechanics work, not accuracy on real video.
- The research relied partly on search summaries for arXiv and publisher pages, marked above.
- Commercial tools disclose no algorithms. Their layout names are product documentation, not evidence of quality.
- Full local gates passed: 587 tests, type checking and lint.
