# Judge the story the viewer receives — 13 September 2026

ClipForge now checks for concrete story-coherence failures without seeing a candidate's generated title, intended hook or previous score. A quoted, validated failure can exclude a candidate before layout analysis, even if its aggregate score is high. This addresses an observed cinematic selection that appended an unexplained scene to an unresolved exchange.

[Inspect eleven reviewed clips](../../.tmp/quality-corpus/editorial-v2/index.html). The gallery plays existing v8 exports; this pass did not render new edits or change those files.

## Findings that changed the approach

An initial cold-viewer pass received only selected speech and six source frames: four in the opening five seconds, one at the midpoint and one near the end. It did not receive titles, hooks, scores or preceding source context. This challenged several earlier review notes:

- Wozniak's computer-budget anecdote explained its stakes quickly enough within the selected speech.
- The puzzle's visible apparatus and commentary supplied an understandable task and result.
- The scope-creep anecdote supplied its own estimated and actual durations; knowing the named participants was unnecessary.
- The telescope explanations and translation-control tip supplied their own topics and conclusions.

These clips were left intact. Conversational openings and ordinary pronouns are not sufficient evidence to add setup or discard a clip.

The harder cinematic controls exposed different problems. The robot-hand confrontation at source 346.25–368.90 seconds cuts to an interior and a chalkboard with the closing words “why does she do this we already tried that one.” The selected material does not explain that prior attempt or resolve the exchange. Both the cold-viewer pass and the updated production reviewer identified this failure; sampled source/export frames also show the scene change.

For the other cinematic excerpt, source 378.00–393.69 seconds, the cold-viewer pass found the closing threat and isolated “good” unresolved. The production reviewer accepted the confrontation as an engaging beat. **This disagreement remains unresolved**, so this study does not claim that both weak film endings were fixed.

The original, unrepaired popcorn introduction was another useful control. The general cold-viewer pass accepted its unusual premise as a landing, but the production reviewer correctly requested a missing visual payoff. The existing specialized demonstration check therefore remains necessary. The repaired popcorn versions from earlier studies were not substituted into this control.

## Production behavior

The existing multimodal visual review now asks for a specific story issue: missing essential context, an unresolved ending, an unrelated scene, or none. A rejecting issue requires a nonempty explanation and an exact 3–30 word quote present in the selected speech. Matching normalizes punctuation and case and respects word boundaries. Invented quotes, unsupported issue types and missing explanations cannot activate the gate.

The request omits generated titles, intended hooks and previous scores. It also excludes words whose midpoints lie in removed timeline gaps, using the same retained ranges as export. Protected visual intervals remain part of that timeline. This is distinct from the optional “hook first” trimming feature, whose behavior was not changed.

The pipeline first attempts its existing missing-demonstration repair and reviews that result. It then applies the **final** story verdict. A known incoherent candidate is excluded before expensive layout and B-roll work; complete alternatives remain. If all candidates fail, the pipeline gives an explicit error instead of recommending them anyway. A failed review request still retains the existing fallback behavior; an unavailable review is not proof of coherence.

This quote check grounds the evidence but cannot establish that the model's interpretation is correct. The categories and thresholds remain provisional. No new formula for measured engagement or probability of going viral was introduced.

## Fixed-selection comparison

| Outcome from the production reviewer | Count | Details |
| --- | ---: | --- |
| Grounded story failure | 1 | The unrelated cinematic scene change; excluded by the new pipeline gate. |
| Missing visual payoff | 1 | The original popcorn introduction; enters the existing repair path. |
| No blocking issue flagged | 9 | Includes the second cinematic excerpt with an unresolved evaluator disagreement. |
| Review request failed | 0 | All eleven returned structured results. |

The production comparison uses its existing six frames distributed across the planned edit, rather than the initial pass's opening-focused sampling. Thus these are two different review protocols, not independent ground-truth annotators. Both use the signed-in Codex CLI default model with user configuration excluded; the requested API-shaped model name is ignored. The final caller replay reused cached responses because these fixtures' retained speech produced identical requests. It is not a fresh repeat establishing judgement consistency.

## Validation and reproducibility

**414 tests across 50 files passed**, both TypeScript projects passed, ESLint passed, and the production Electron/Vite build passed. New checks cover absent titles/hooks, retained speech, six frame inputs, valid and invented evidence, word-boundary matching, rejection despite high scores, complete alternatives, and using a repaired clip's final verdict rather than a stale initial failure.

[Cold-viewer results](../../.tmp/quality-corpus/cold-openings/review.json), [production review](../../.tmp/quality-corpus/editorial-v2/review.json), [runner hashes and provenance](../../.tmp/quality-corpus/editorial-v2/provenance.json), [original per-clip review notes](improvement-review-notes.json).

The earlier notes remain historical observations; this study qualifies their claims about missing context rather than silently rewriting them. These are eleven existing selections, not a new all-source selection benchmark. No new full pipeline selection/render run, native-preview check, human retention study, independent speaker labelling or matched OpusClip comparison was performed in this pass. Existing saved projects are not silently pruned. General selection quality and OpusClip parity remain unproven.
