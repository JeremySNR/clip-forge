# Speaker-detail guard validation (2026-09-19)

The guard previously counted a frame as detailed if any tracked face exceeded the area threshold. A large silent listener could therefore excuse an unresolved face that had the highest speaking score. The change bases the area check on the leading scored face, matching the existing small-face resolution check. It does not change speaker scores, focus selection, or zoom thresholds.

A regression test covers a tiny leading speaker beside a large listener in both track orders, plus an ordinary detailed speaker. All 441 tests, both TypeScript configurations, and ESLint pass.

The local `.tmp/validate-speaker-guard.ts` compares the prior committed implementation with the change against three cached analyses of Gilly Forrester's 193.3–231.34-second excerpt (UltraFace/640, YuNet/640, YuNet/1920). Each contains 952 frames. All three retain the same protected interval, relative 30.68–38.08 seconds. Results are saved in `.tmp/speaker-guard-validation.json`.

These old caches do not record crop dimensions, so the comparison exercises the area-only path, not the resolved-small-face override. The regression tests separately cover that override. No inference or renders were repeated: unchanged layout ranges provide no new visual-quality evidence. The change has not been demonstrated to improve the Godot panel or validated against independently labeled active speakers. It addresses an inconsistent guard, not established speaker-detection accuracy or OpusClip parity.
