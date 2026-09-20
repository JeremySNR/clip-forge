# Adaptive clipping: v0.11.0 implementation checkpoint

This release implements an initial presenter/content workflow within the existing Electron application. It does not complete the [broader roadmap](adaptive-clipping-build-plan.md), establish a universal quality guarantee, or demonstrate improved audience retention.

## Available now

- Versioned composition data lives in existing project JSON. Each shot can contain independent content and presenter source rectangles, fitted into disjoint destination panels. Regions are independent of the inset's original corner.
- Preview and FFmpeg export consume the same even-pixel crop and destination geometry. Preview uses one video element and a canvas; export splits one decoded source. Audio is not duplicated. Timed compositions participate in the existing trim and tightening timeline.
- Automatic screen-content analysis proposes a separate inset and content region. Geometric checks reject overlap, invalid bounds, tiny faces, excessive enlargement and insufficient content gain. Seven actual rendered samples compare the candidate with full-scene fit; one alternate template is attempted after rejection. A rejected proposal preserves the full shot. Samples are evidence, not continuous motion verification.
- The editor offers Automatic, Content first, Stacked and Content only. Users can create or correct regions in source percentages without AI. A revision protects saved manual regions against late inference results. Completed legacy projects are not automatically reanalysed.
- Caption space is reserved. Existing full-width hook titles are suppressed for compositions to prevent presenter occlusion. Other aspect ratios retain the full source rather than reusing portrait coordinates.
- A shared in-process queue admits one or two face-analysis, composition or export tasks according to memory and CPU availability. Queued exports take priority; cancellation removes queued work. This is admission control, not durable job persistence.
- FFmpeg decoder/filter/CPU-encoder threads are bounded. Face-crop collections above 64 MiB spill to temporary files and are read in bounded, overlapping inference windows. This bounds crop-image storage; metadata, audio features and embeddings still scale with recording length.
- Exports use a temporary destination, check dimensions/duration/audio, fully decode, and replace the requested output only after validation. Failed or cancelled attempts preserve prior outputs.

No new runtime dependencies, service, database or separate renderer were introduced. Automatic semantic analysis uses the existing configured provider and billing controls; manual composition and rendering remain local.

## Validation completed locally

- 481 tests pass, plus type checking, lint and production build. Two existing CLI tests require local IPC socket permission outside the sandbox; both passed with that permission.
- Real video fixtures export presenters from every source corner, check output pixels before/after a layout switch, assert portrait dimensions and one audio stream, and confirm failed exports preserve existing files.
- Tests cover invalid and contradictory proposals, one bounded alternate attempt, region geometry, trim guards, manual-save races, queue limits/cancellation/failure recovery, disk/memory crop equivalence, and decoder cleanup after abort or consumer failure.
- An isolated native Electron profile verified the user's screenshot rendered through the production compositor, initial paused pixels, preset switching, manual region creation/correction, persistence, play/pause including clicking the composition, seeking and window resizing. This is a static-image fixture, not a real moving-webcam benchmark.
- Automatic model responses are mocked in regression tests. No paid cloud analysis or audience-retention experiment was used to claim quality.

The release workflow additionally validates packaged Apple Silicon inference and export, builds Windows/macOS/Linux installers, and verifies every installer and update manifest before publication.

## Remaining work, in priority order

1. **Held-out quality corpus and release gates.** Acquire licensed/consented recordings across lectures, webinars, demos, interviews and ordinary footage. Split by creator/setup, annotate essential content and acceptable framing, run blind human comparisons and track severe failures, review rate and omissions. Existing synthetic tests establish mechanics, not success rates on arbitrary video.
2. **Moving regions and layout changes.** Add stable 2D panel tracks, change-point detection, missing-panel handling and temporal smoothing. Currently regions are fixed within each shot and only sampled for stability. Abrupt moves between samples can be missed. Prefer full-scene fit or manual correction until supported.
3. **Explicit reanalysis and better correction UI.** Add a narrowly scoped reanalyse-layout action for completed clips, with cancellation and stale-result protection. Add draggable source overlays, per-shot locks and a way to accept a reviewed manual result. Percentage fields and persistent review notices are the current recovery path. Extending a manually composed clip beyond its saved layout coverage falls back; rebuilding only the new interval remains work.
4. **Durable orchestration and complete budgets.** Persist job checkpoints and cache keys tied to source/model/prompt/revision; recover after crashes and remove abandoned temporary files. Extend admission control across transcription and all analysis stages. Add project-wide cost limits, disk preflight, thermal/power policies, quiet mode and measured time estimates. Current provider limits remain in force, but this release adds no whole-project budget manager.
5. **Full quality reports and targeted repair.** Bind technical, visual and editorial evidence to a specific edit revision. Add continuous motion/occlusion checks, independently verified text legibility, caption/title/branding/B-roll collision checks, audio continuity and a limited repair loop. Do not rename sampled layouts to Ready until those gates and corpus results support it.
6. **Broader clip selection and layouts.** Add visual-event candidates, object/action relationship tracking, speaker panels, dialogue/shared layouts and duplicates across selected clips. Sports, gameplay, demonstrations without text, portrait sources and multi-person calls need their own benchmarks and fallback rules. Existing speaker and screen-detail paths remain available; they are not newly certified.
7. **Hardware and long-recording measurement.** Benchmark complete one-hour workflows on low-memory Windows/Linux and Intel/Apple Silicon machines, measure peak RAM, temperature, responsiveness and wall time, test disk-full/restart recovery and actual OS upgrade paths. Add tested VideoToolbox/other hardware encoders if useful; current acceleration remains the existing NVENC path with CPU fallback. Full-decode export validation adds work proportional to output duration.
8. **Optional managed cloud execution.** If needed after measurement, add explicit per-project data-sharing controls, resumable uploads, retention/deletion controls, quotas, idempotent remote jobs and provider failover. No new media upload route or managed backend ships here.

Keep these notes alongside subsequent PRs. A successful installer build must not be treated as evidence that these remaining quality or scaling requirements have been met.
