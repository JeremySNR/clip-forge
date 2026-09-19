**Cutawan video-quality review — 12 September 2026**

**Implementation update:** The first quality milestone now preserves original speech through caption edits, scouts for returning faces throughout clips, records framing coverage and handles trim/relink races, enforces duration limits after refinement, and retains export brand colours without requiring a logo. An offline, provider-neutral benchmark and blind video-review generator are documented in [quality-benchmark.md](quality-benchmark.md). The findings below describe the reviewed baseline; these fixes do not establish Opus parity or select a winning replacement model. Remaining architectural recommendations still require real-footage comparisons.

Cutawan has a credible foundation for high-quality talking-head and podcast clips. Its strongest work is the local rendering pipeline, shared preview/export planning, real audio-visual active-speaker detection, and explicit review of clip endings. Those are useful assets, but none of the present algorithms, models, pipeline stages, or deployment choices should be presumed optimal. Reaching or beating OpusClip requires choosing methods by their effect on finished videos, including replacing substantial parts of the pipeline when alternatives perform better.

Podcasts/interviews are a useful first evaluation category, not an assumed limit on the product. Sports, gameplay, demos, and visual storytelling need their own evaluation categories. The current implementation's strengths should not determine which source types the future product can handle.

**Method-selection principle: quality first, existing implementation earns its place**

Do not choose LR-ASD because it is already bundled, Whisper because it is already connected, FFmpeg filters because they already exist, or a single provider because settings currently support it. Establish the best achievable reference output first. Then measure the quality lost by cheaper, smaller, quantized, local, or faster alternatives. Report runtime and cost alongside quality rather than quietly making them the optimization objective.

Full-video uploads, additional paid services, and large model installations were not performed for this review. Cloud/GPU-backed approaches belong in the technical comparison; choosing or deploying one would be a separate implementation decision.

The following is a researched shortlist, not a claim that untested candidates are universally best. Freeze exact model versions, preprocessing, weights, and configurations when running comparisons.

| Component | Methods to compare | Selection criterion |
| --- | --- | --- |
| Speech recognition | Current Whisper baseline; Qwen3-ASR-1.7B; NVIDIA Parakeet-TDT-0.6B-v3; a strong hosted batch system such as Scribe v2 | Word/name/number accuracy, verbatim retention, omissions, hallucination on silence, accents, overlap, and language switching. |
| Word alignment | Provider word timestamps; WhisperX alignment; Qwen3-ForcedAligner on the same corrected transcript | Start/end timing error and whether actual cuts preserve consonants and syllables. Test alignment independently of ASR accuracy. |
| Audio speaker turns | pyannote Community-1; hosted Precision-2; an integrated transcription/diarization provider | Diarization error, speaker confusion, overlapping speech, and short-turn recall with identical scoring conventions. |
| Visible speaker activity | Current LR-ASD; LoCoNet with TalkNCE; NVIDIA's integrated ASD stack; GateFusion as a research candidate subject to reproducible code/weights | Frame-level ASD accuracy plus wrong-person screen time and recovery after occlusion/cutaways. |
| Detection and identity tracking | Current UltraFace/IoU; higher-resolution SCRFD with landmarks and appearance association; BoT-SORT-style motion/appearance/camera-motion association adapted to faces | Small-face recall, identity switches, fragmented tracks, and continuity through motion. Pedestrian tracking scores do not establish face-tracking quality. |
| Shot/event timeline | Current frame-difference threshold; TransNet V2; additional targeted visual/audio event analysis | Missed cuts/dissolves, false cuts during motion, and event recall. |
| Moment discovery | Transcript-led baseline; direct video-language-model discovery; dedicated temporal grounding plus independent editorial selection; hybrid candidate union | Human-labeled worthwhile-moment recall, publishable top-five precision, context completeness, and diversity on held-out full videos. |
| Composition | Existing horizontal track; shot-level constrained camera-path optimization; learned/editor-preference policies once sufficient labels exist | Subject/content visibility, headroom, crop softness, unwanted movement, and blinded composition preference. |
| Pacing and enrichment | Existing rules; audio/semantic edit planning; optional model-proposed edit alternatives checked against source | Natural rhythm, meaning preservation, retained reactions, intelligibility, and viewer preference. |

Speech shortlist evidence: [Qwen3-ASR and ForcedAligner](https://github.com/QwenLM/Qwen3-ASR), [Parakeet model card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3), [Scribe v2 API](https://elevenlabs.io/docs/api-reference/speech-to-text/convert), and [WhisperX](https://github.com/m-bain/whisperX). Qwen's recognition and alignment language coverage differ; test the requested languages explicitly.

For diarization, pyannote's own benchmark table reports lower error for Precision-2 than Community-1 across its listed datasets, including 8.5% versus 11.2% on VoxConverse and 14.7% versus 20.2% on DIHARD 3. These are provider-reported results under stated conditions, not measurements of Cutawan footage. They justify including the hosted option in a quality-first comparison rather than assuming local open-source inference is sufficient. [Model card and methodology](https://huggingface.co/pyannote/speaker-diarization-community-1).

For ASD, [GateFusion, WACV 2026](https://openaccess.thecvf.com/content/WACV2026/html/Wang_GateFusion_Hierarchical_Gated_Cross-Modal_Fusion_for_Active_Speaker_Detection_WACV_2026_paper.html) reports results on Ego4D-ASD, UniTalk, and WASD, using pretrained encoders and gated cross-modal fusion. [UniTalk](https://arxiv.org/abs/2505.21954) specifically identifies the domain gap between movie-based AVA evaluation and challenging modern footage. Treat this as a reason to test broad generalization, not to select a model from one reported mAP number. [TalkNCE](https://github.com/kaistmm/TalkNCE) supplies a LoCoNet checkpoint trained with its contrastive objective. [NVIDIA's ASD model card](https://build.nvidia.com/nvidia/active-speaker-detection/modelcard) describes face detection, appearance embeddings, and audio-visual activity components together; its [support matrix](https://docs.nvidia.com/nim/maxine/active-speaker-detection/1.0.0/support-matrix.html) must inform deployment feasibility.

For tracking and cuts, [BoT-SORT](https://github.com/NirAharon/BoT-SORT) and [TransNet V2](https://github.com/soCzech/TransNetV2) provide reproducible alternatives to the current handcrafted associations and shot threshold. Neither should be declared best merely because it has a published paper.

For discovery, compare native video analysis through [Gemini's video API](https://ai.google.dev/gemini-api/docs/video-understanding) with an open-weight video-understanding option such as [Qwen3-VL](https://github.com/QwenLM/Qwen3-VL), and a specialized grounding approach such as [TimeLens](https://github.com/TencentARC/TimeLens). A general vision-language model's video understanding is not necessarily precise temporal localization; a grounding model's localization accuracy is not necessarily editorial judgment. Benchmark both tasks, and do not treat sparse-frame video input as equivalent to watching every visual event.

**The architecture I would test against the current one**

Use a source-faithful analysis timeline, separate evidence extraction from creative decisions, and exploit the fact that this is offline editing: the system can inspect what happens next before deciding where to cut or point the camera.

1. Decode with correct orientation, timing, and color interpretation. Preserve original media and a lossless analysis audio stream.
2. Produce competing ASR outputs on the evaluation set, correct or resolve uncertain text, then align words acoustically. Keep non-speech events and overlapping speakers instead of forcing everything into one flat word stream.
3. Associate audio speaker turns with persistent face tracks using audio-visual synchrony and confidence. Use separate source audio channels when they genuinely isolate speakers. Model offscreen speech and uncertain identity explicitly.
4. Build shots and visual events; compare direct multimodal selection with retrieval-assisted selection. Candidate generators should be allowed to find moments outside the transcript's strongest passages.
5. Propose alternative complete edits. A separate reviewer checks context, hook, development, payoff, audience relevance, and source fidelity; rejection remains an acceptable outcome.
6. Optimize layout across each shot and across speaker turns. Candidate states can include single-speaker crops, two-person layouts, full-frame content, and screen-share composites. A temporal optimizer can penalize clipped faces/text, poor headroom, excessive crop motion, rapid switching, and insufficient source resolution. Compare that policy with simpler baselines rather than assuming complexity wins.
7. Apply acoustic/semantic pacing edits and intentional visual emphasis. Inspect reactions and source camera motion before adding effects.
8. Render proof outputs and score the finished edits. Allow repair of a specific failed stage rather than regenerating unrelated decisions.

The crop optimizer is a proposed method, not a measured result. Google's [AutoFlip](https://research.google/blog/autoflip-an-open-source-framework-for-intelligent-video-reframing/) is an older but useful methodological reference for whole-shot analysis, choosing stationary/pan/tracking modes, and fitting a smooth camera path to important regions. Its age is not a reason to discard the optimization idea, and its existence is not a reason to adopt its original detectors unchanged.

Test whole-system combinations as well as individual models. More accurate diarization can still yield worse visual cuts if the switch policy overreacts to short acknowledgments. Better word recognition can still produce worse captions if the aligner mishandles punctuation or rapid speech. Run ablations with labeled intermediate inputs to identify which component actually causes failures.

The winner should be the system with the best held-out finished-video results and acceptable deployment characteristics. If a hybrid or heavier approach wins meaningfully, change the architecture to support it. Optimize its runtime afterward and measure any quality regression.

**Scope and evidence**

Reviewed the main analysis, transcription, tracking, scoring, captions, tightening, zoom, B-roll, rendering, editor, persistence, IPC, tests, and CI paths. Consulted current official OpusClip documentation and primary project documentation for potential alignment and diarization components.

This is a source-code and offline pipeline review, not a measured head-to-head against OpusClip. No representative real source videos and matching OpusClip exports were evaluated. Synthetic export success cannot establish speaker accuracy, editorial quality, or engagement. No application source changes were made; the pre-existing staged README change was preserved.

Validation completed:

- 325 unit tests passed across 35 files.
- ESLint passed.
- Renderer TypeScript check passed.
- Main-process TypeScript check failed because this local installation cannot resolve `electron-updater`, which is declared in package.json. This is an installed-dependency issue, not evidence of a faulty media algorithm.
- Existing offline `test-pipeline.ts` and `test-quality.ts` passed, including actual FFmpeg exports. A generated vertical captioned frame was visually inspected.
- Four targeted behavior checks reproduced the caption-hiding, tracking bailout, stale tracking, and clip-duration issues below. The temporary harness is [.tmp/review-quality-check.ts](../.tmp/review-quality-check.ts).
- The ordinary npm launcher failed due to a missing npm CLI at its resolved roaming path. Checks used installed local tools directly; Vitest and integration tests required execution outside the filesystem sandbox for configuration resolution.
- Live AI output, real-person ASD accuracy, desktop interaction, and packaged-app behavior were not validated in this review.

**What is already worth keeping**

The app uses LR-ASD audio-visual scores, not just the largest face or mouth movement. It applies switch persistence and cooldown, isolates face tracks at detected cuts, and smooths crop movement within a shot. These are useful building blocks. The upstream [LR-ASD project](https://github.com/Junhua-Liao/LR-ASD) provides research code and trained models, although its published benchmark results do not establish the accuracy of this application's preprocessing and camera decisions.

Highlight selection includes hook/build/payoff guidance, sentence-aware boundary snapping, an ending review, optional opening review, and temporal deduplication. The export path has good CPU quality settings, Lanczos scaling, bundled fonts, measured loudness normalization, cancellation, and GPU fallback. Shared timeline math helps keep effects aligned after tightening. Transcript reuse and per-project write locks also avoid unnecessary work and some common editing races.

These strengths make controlled comparisons practical. Electron and React need not dictate the inference runtime or model choices; a separate service or worker can run a substantially different quality pipeline.

**Confirmed defects and high-confidence behavior problems**

| Priority | Finding | Viewer or editor impact | Change |
| --- | --- | --- | --- |
| P1 | Hiding a caption can cut source media | The editor says clearing a word hides it from captions. The tightening planner consumes only nonempty displayed words, so clearing text can create a removable speech gap. A synthetic example lost 1.92 seconds of audio/video after one word was hidden. | Preserve immutable spoken-word timing; store caption visibility/text separately from media edits. |
| P1 | Face detection stops after a temporary absence | Three seconds without a face, or a sparse opening probe, stops the detection pass for the remaining analysis window. Speakers returning after a cutaway are never inspected. | Switch to periodic sparse detection and resume dense tracking when faces return; retain shot boundaries through the entire window. |
| P2 | Extending a clip does not invalidate finished tracking | `needsReframe` checks only the pending flag. A clip extended beyond its analyzed range keeps a finished status and can hold an old crop over new footage. | Store analyzed range, source fingerprint, and model version; analyze missing coverage and reject stale results. |
| P2 | Ending refinement can exceed the promised duration cap | The initial selection enforces a 45-second cap for short clips, but later ending refinement can extend it substantially. A 44-second clip became 80.6 seconds in the targeted check. | Validate the final edit after all refinements; find a complete shorter ending or explicitly classify it as a longer alternative. |
| P2 | Brand colors depend on a usable logo during export | IPC passes branding only when the watermark is enabled and its image exists. Preview caption colors are read independently. A color-only brand can therefore render differently. | Pass colors independently; gate only the watermark image overlay. |

Evidence: [tighten.ts:63](../src/shared/tighten.ts:63), [caption word filtering](../src/shared/captionLayout.ts:25), [TranscriptEditor.tsx:17](../src/renderer/src/components/TranscriptEditor.tsx:17), [ASD bailout](../src/main/pipeline/asd.ts:131), [tracking invalidation](../src/shared/reframe.ts:41), [highlight refinements](../src/main/pipeline/highlights.ts:594), [branding export](../src/main/ipc.ts:258).

**1. Improve which moments become clips**

This is the largest strategic gap. `detectHighlights` receives the transcript and energy tags. Only after it selects candidates does `assessClipVisuals` inspect three source frames and rerank them. A reveal, facial reaction, physical demonstration, gameplay event, or silent gag omitted by the text pass cannot be recovered by reranking. The main flow also rejects footage with no detected speech.

The visual frames occur at 8%, 50%, and 92% of a candidate. For a 90-second clip, the supposed hook frame is 7.2 seconds in. The scorer sees source footage before reframing, captions, tightening, and B-roll, so it cannot judge the actual finished opening. Its transcript excerpt is also truncated to 900 characters.

OpusClip advertises discovery using visual, audio, and sentiment cues, including low-dialogue footage and compilation of moments from different parts of a video. These are useful capability targets, not proof of superior output on every input. [Official ClipAnything description](https://www.opus.pro/clipanything).

I would introduce a staged selection process:

1. Build a reusable source timeline: sentences, speaker turns, shots, voice activity, laughter/reactions, and visual events. Sample sparsely throughout the source and inspect promising regions more densely.
2. Generate a generous internal candidate pool using transcript themes, visual events, and audio reactions. Use overlapping chapter windows plus whole-video context for long sources.
3. Review candidates independently for cold-viewer comprehension, a genuinely strong opening, a developed idea, a landing, and faithfulness to the source. Store evidence spans and failure reasons.
4. Offer alternative boundaries around strong moments. An editor should be able to compare a tight 25-second answer against a complete 45-second explanation.
5. Rank for the intended audience and format, then enforce topic diversity. Temporal overlap alone cannot detect the same point repeated ten minutes later.
6. Review the final edited clip before calling it ready to post.

Keep candidate generation generous, but make publishable recommendations selective. The current fallback insists on at least three clips even when quality is weak. It is reasonable to expose those as lower-confidence candidates; they should not be presented as equally ready to publish.

Do not jump straight to autonomous rearrangement of quotes. Start with contiguous clips and optional, inspectable removal of redundant sentences. Later support noncontiguous assemblies with source provenance and a check that the edit preserves meaning.

Evidence: [pipeline order](../src/main/pipeline/index.ts:164), [selection prompt](../src/main/pipeline/highlights.ts:621), [visual sampling](../src/main/pipeline/visualScore.ts:54).

**2. Turn speaker detection into good camera direction**

Three separate problems need separate representations: who is talking in the audio, which visible face belongs to them, and which composition is best at that moment. The current transcript has no speaker IDs. Face tracks use greedy box-overlap matching, and the final focus keyframe retains only horizontal position plus a cut flag.

That representation cannot express adjustable headroom, face size, vertical movement, a two-person stack, a screen-share layout, or an object that needs to remain visible. An entire clip is classified as either speaker or screencast. Whole-video mode makes that decision using 120-second windows and can hold the previous crop through a screen-share interlude.

I would add:

- Audio diarization and overlap detection, associated with visible face tracks using temporal evidence. [pyannote.audio](https://github.com/pyannote/pyannote-audio) is a candidate to benchmark, not an assumed drop-in solution.
- Better tracking through motion and occlusion; benchmark detector resolution and identity association before replacing LR-ASD. Detection at 320×240 and crop extraction capped at 640 pixels wide deserve special testing on remote-call grids and small faces.
- An explicit unknown/offscreen-speaker state. Low confidence should select a safe wide or split layout or request review, rather than force a confident-looking close-up.
- Per-shot layout segments containing subject IDs, crop rectangles, confidence, and transitions. Preserve face boxes and important visual regions until composition is complete.
- Shot-aware lookahead to place switches at the beginning of a confirmed turn while ignoring brief backchannels. Keep reactions when they are the point of the moment.
- A simple editor override: choose the person to follow for a time range, lock the composition, or use two-person framing.

OpusClip documents split, multi-person, screenshare, and gameplay layouts plus per-segment adjustments. That is a tangible compositional gap beyond speaker detection itself. [Official layout documentation](https://help.opus.pro/docs/article/layout-and-reframing).

Evidence: [types.ts:14](../src/shared/types.ts:14), [focus representation](../src/shared/types.ts:76), [face association](../src/main/pipeline/facetracks.ts:113), [whole-video decisions](../src/main/pipeline/wholeVideo.ts:170).

**3. Preserve timing, meaning, and natural pacing**

Word timestamp normalization makes timestamps ordered and nonempty; it does not establish that they match the acoustic word boundaries. Those same timestamps drive captions, trims, tightening, and B-roll, so timing errors propagate across the finished video.

Add forced alignment, confidence, and a correction workflow for names and specialist vocabulary. [WhisperX](https://github.com/m-bain/whisperX) demonstrates an alignment-plus-diarization architecture worth testing. Its documentation also notes limitations with overlap, some tokens, and language-specific alignment models; it should be evaluated on this project's actual material.

The tightening planner currently treats gaps in retained transcript words as removable and labels words such as “hmm”, “mhm”, and “ah” as fillers. That can remove a meaningful acknowledgment, laughter not transcribed as speech, or the pause before a reveal. It defaults on for AI highlights.

Offer gentle, standard, and aggressive pacing, backed by voice activity and protected emotional/reaction spans. Snap joins to safe acoustic boundaries, add short audio fades at internal joins, and allow individual removals to be restored. Preserve source-word timing independently of caption presentation.

Zoom is described as scene-aware, but its planner receives transcript energy, the clip range, and tightening joins—not detected source shots, face geometry, or camera motion. It adds creep after sufficiently long stretches and punches on loud segments. I would replace the periodic-motion rule with intentional emphasis, avoid stacking zoom on a camera push-in, reset at source cuts, and constrain zoom by face position and available source pixels.

Evidence: [timing normalization](../src/main/pipeline/transcribe.ts:63), [tightening](../src/shared/tighten.ts:48), [zoom inputs](../src/shared/zoom.ts:68), [internal joins](../src/main/pipeline/render.ts:274).

**4. Judge captions and image quality in the finished composition**

The shared caption layout and bundled font metrics are good engineering. However, width estimation still uses character count times an average glyph width, oversized words can overflow, and caption placement has no face, object, or platform-interface collision model. CSS preview and ASS export remain different renderers: B-roll fades, caption pills, title shapes, and some timing behavior are approximations rather than identical output.

Priorities are word-timing correction, phrase-aware grouping, actual glyph measurements, adjustable safe areas, collision checks, and a short rendered proof using the export compositor. More styles can follow. Add a caption-timing editor and independent text/visibility controls.

The existing high-quality CPU encoder setting is already sensible: x264 slow at CRF 17. The greater risk is how much useful source detail survives the crop. A full-height 9:16 crop from 1920×1080 landscape footage contains only about 608×1080 source pixels before being enlarged to 1080×1920. Additional zoom reduces that further. Higher bitrate cannot recover the missing detail.

Use crop-aware resolution budgeting, preserve high-resolution source footage, and allow a wider or split composition when a close-up would be too soft. Add explicit rotated-video, pixel-aspect-ratio, variable-frame-rate, and HDR/color-management handling. The current probe retains dimensions and average FPS but not the metadata needed for those decisions. Render motion from presentation timestamps or normalize to a deliberate frame rate; the zoom expression currently uses frame index divided by average FPS.

For audio, retain measured normalization and add optional denoise, de-reverb, and speaker-level balancing only after listening tests. Measure the final encoded output's loudness and true peak. The existing quality test checks audio stream presence; it does not verify that output achieves the stated loudness target.

Evidence: [caption layout](../src/shared/captionLayout.ts:102), [preview compositor](../src/renderer/src/components/PreviewPlayer.tsx:385), [source metadata](../src/main/pipeline/ffmpeg.ts:130), [output dimensions](../src/main/pipeline/render.ts:68), [encoder settings](../src/main/pipeline/encoders.ts:136).

**5. Treat engagement as an outcome to learn from**

The current 0–99 score is an LLM rubric blended 60/40 with another LLM assessment. Energy is a relative RMS loudness percentile, not a measurement of emotion or interest. Loud music and microphone differences can influence it. The selected clips' text scores are not refreshed after opening/ending edits, and visual scoring happens before the final edit.

This can be useful for sorting, but it is not a calibrated probability of going viral. Referencing sharing research does not validate the particular weights, prompt, or performance on short-form video. OpusClip likewise describes a heuristic-style hook/flow/value/trend score; its public scoring description should not be treated as ground-truth engagement measurement. [Official scoring explanation](https://help.opus.pro/docs/article/virality-score).

Initially show editorial subscores and explanations: hook, clarity, payoff, pacing, visual quality, audience fit, and uncertainty. Record accept/reject decisions and how much creators changed the result. Later import publication outcomes, with user authorization, and compare retention, completion, shares, and saves within similar channels, formats, lengths, and topics. Raw view counts alone confound content quality with distribution and account size.

Use human preferences and creator decisions before training a custom ranker. If enough data accumulates, train or calibrate against held-out sources and creators. A stronger general model is worth a controlled experiment; it cannot compensate for missing visual candidates or broken framing.

**6. Make B-roll earn its place**

Current B-roll is keyword-triggered still-image search. It chooses the first qualifying result without checking that the actual image is relevant, attractive, sharp enough for the planned crop, or compatible with the composition. Wikipedia results as small as 200×200 can qualify, and the default overlay occupies the upper center where a speaker's face may be.

Prefer supporting visuals from the source itself, then an optional creator asset library, then external material. Validate image content and effective resolution, use shot-aware timing, and avoid covering the expression that made the clip engaging. Keep asset provenance and license metadata with the project. Do not add generic footage merely to keep the frame moving.

Evidence: [B-roll planner](../src/main/pipeline/broll.ts:77), [image selection](../src/main/pipeline/imagesearch.ts:43), [overlay composition](../src/main/pipeline/render.ts:464).

**7. Add a real quality benchmark before judging parity**

The current tests establish useful implementation correctness. The saved-project evaluator checks sentence boundaries and tail room; scripted LLM tests verify orchestration. Neither measures whether a cold viewer wants to watch the clip. The ASD script is a debugging/annotation harness, not a labeled accuracy benchmark.

Start with 20–30 representative source videos: solo speakers, two-person podcasts, rapid exchanges, overlap, accents, poor microphones, screen shares, cutaways, moving speakers, and subtle emotional stories. Include weak material to test appropriate abstention. Have editors label strong moments, acceptable boundaries, speaker turns, important visuals, and protected reactions.

Evaluate three separate tasks:

- Discovery: which worthwhile moments are found and which top-five suggestions are usable?
- Editing: given identical source boundaries, which system produces the better finished video?
- End-to-end: which system yields more publishable clips with less human repair?

Compare Cutawan, the current OpusClip configuration, and human edits using blinded order and matched source/settings. Keep whole source videos and creators separated between tuning and holdout sets. Report uncertainty and results by content type rather than a single flattering average.

Suggested initial engineering targets, to revise after establishing the baseline:

| Measure | Proposed target |
| --- | --- |
| Top-five suggestions accepted with only minor edits | At least 80% on the chosen podcast/interview niche |
| Correct focus during clearly visible, single-speaker speech | At least 95%; report overlap and offscreen cases separately |
| Unintended wrong-person framing lasting over one second | None in the release regression set |
| Audibly clipped words or changed meaning | None in reviewed release exports |
| Caption word-boundary timing | 95th-percentile absolute error below 150 ms on manually aligned words |
| Caption/important-content collisions | None in the annotated regression set |
| Human repair time | Median under one minute per accepted clip |
| Comparative preference | Demonstrated on held-out clips with confidence intervals; no parity claim from a handful of examples |

Add automated final-file checks for decode errors, unexpected black/frozen frames, A/V drift across many joins, caption overflow, loudness/peak behavior, and mismatch with the approved render plan. Validate selected outputs after actual platform recompression as a later step.

**Recommended implementation order**

| Sequence | Deliverable | Why it comes here |
| --- | --- | --- |
| First | Benchmark corpus and baseline; fix the reproduced defects; add source/analysis coverage metadata | Establish trust and prevent regressions while the quality architecture evolves. |
| Second | Alignment and speaker turns; resumable face detection; per-shot crops and two-person layouts; manual overrides | Better audio boundaries and composition improve almost every usable clip. |
| Third | Multimodal candidate discovery; independent editorial review; semantic diversity; boundary alternatives | Find stronger moments and make their standalone story clearer. |
| Fourth | Context-sensitive pacing/zoom, final-render proof and QC, higher-quality visual assets | Add polish once selection and composition are dependable. |
| Ongoing | Creator feedback and controlled outcome measurement | Learn which changes help real audiences. |

For a first bounded implementation milestone, I would create the repeatable real-video comparison harness and adapters for alternative methods, while fixing the five defects above. Run speech/alignment, speaker-association, and discovery comparisons before committing to a replacement stack. The benchmark should determine whether incremental changes or a larger pipeline replacement is warranted; implementation convenience should not make that decision.

Supporting architecture should preserve the current shared planner but evolve toward a versioned edit decision list containing media segments, caption events, speaker identities, layout segments, effects, and confidence. Cache analysis by source fingerprint and model version; use a separate worker process for heavy inference. The current full-track ASD input alone needs roughly 144 MiB of float video data for one 120-second face track, before crops and model activations, so bounded inference windows matter on desktop hardware.

Also add atomic project-file replacement with recovery backups, per-chunk transcription checkpoints, and explicit degraded-quality states for failed visual/ASD/refinement stages. Current JSON write locks serialize writes but do not make them crash-safe; caught model failures often leave a result looking fully analyzed. These reliability improvements protect editing work and make quality failures visible.

The success criterion should be **more clips a creator wants to publish, better finished composition, and less corrective editing**. Report that result separately by content category and expand the benchmark as the product's scope grows.
