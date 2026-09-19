# Full pipeline review — 12 September 2026

The existing ChatGPT sign-in worked through Codex CLI for real clip selection, ending refinement and visual scoring. Local Whisper large-v3 supplied transcription on the RTX 4080 SUPER. No OpenAI Platform API key was required. This is an experimental test-run bridge; it has not been added to the app's Settings UI.

## Results

All nine full-length sources were submitted. Eight completed and exported their top three clips: **24 vertical videos, 11 minutes 2 seconds total**. The silent Blender tutorial failed during audio extraction with FFmpeg's “Output file does not contain any stream” error. It needs an explicit no-audio workflow. All 24 exported videos passed full decoding; no full-frame black intervals were detected. Technical validity does not mean editorial quality.

- [Play all 24 clips with review notes](../../.tmp/quality-corpus/full-baseline/review.html)
- [Detailed per-clip findings](export-review-notes.json)
- [Run status and actual providers](../../.tmp/quality-corpus/full-baseline/run.json)
- [Review data, transcripts and technical checks](../../.tmp/quality-corpus/full-baseline/review.json)
- [Source catalog, credits and licenses](README.md)

## What the outputs reveal

| Area | Evidence | Priority |
| --- | --- | --- |
| Complete stories and boundaries | Wozniak's diploma anecdote finishes, then the export appends the next interview question. Similar handoffs appear in the panel, Hannah and Gilly interviews. The panel publisher clip visibly ends with a stray “BECAUSE” caption. | Highest: select a complete editorial unit, then enforce safe word boundaries. |
| Preserve the subject | Gilly rank 1 cuts out the puzzle during the timed attempt. Presentation rank 2 removes the popcorn installation image while retaining the tiny presenter inset. | Highest: score the final crop for retained objects, actions and text, not just visible faces. |
| Framing and speaker choice | Wide panel shots waste space on wall and audience; several studio-wide samples frame a listener; cinematic close-ups cut into faces. | Use shot-level composition, subject bounds, headroom and conservative fallback. Measure speaker accuracy separately. |
| Actual hook and payoff | Strong generated titles often sit above exports starting “But, well” or “And so...”. NASA's TRAPPIST-1 title promises a “why” explanation the clip barely supplies. | Judge the rendered opening and delivered payoff, with surrounding context. |
| Non-speech content | The popcorn clip stops at its spoken introduction, omitting the demonstration. The silent tutorial cannot enter the speech pipeline. | Add meaningful visual/action intervals to candidate generation and a visual-only path. |
| Captions | “BECAUSE” appears after the story ends; awkward “pre -linguistic”, duplicated words and suspicious proper nouns occur. Screen captions overlap dense UI text. | Verify transcript corrections and alignment; place captions around protected content. |
| Screen readability | Narrated demo rank 1 destructively crops the UI; ranks 2–3 fit the full screen into a narrow strip with large black areas. | Detect the demonstrated UI region and use readable detail views with context. |
| Diversity | Presentation ranks 2–3 cover the same popcorn installation; film ranks 1–2 repeat the robot-hand conflict. | Penalize semantic redundancy after minimum quality requirements pass. |

There are useful selections: NASA's Webb explanation, Hannah's explanation of changing flood risk, and the screen tutorial's draft-saving tip have coherent cores. Gilly's ape-language reversal and Wozniak's fake-name diploma story are promising once their endings are repaired. These are editorial assessments, not measured retention or evidence of OpusClip parity.

## Implementation direction

1. **Separate semantic selection from padding.** Store the intended first/last word or sentence independently of rendered pre/post-roll. Bound padding by adjacent speech and use waveform/VAD or forced alignment to locate safe cuts. Validate that a final range contains no accidental next-question fragment. Preserve a complete claim, explanation or payoff rather than treating punctuation as proof of completeness.
2. **Make layout vary by shot.** Track face and object rectangles, slides/text, hands and demonstrated controls. Select among close-up, two-person layout, detail view and fit based on what must remain visible. Add headroom and crop-containment constraints before stylistic zoom. On uncertain speaker identity, preserve context instead of confidently selecting one face.
3. **Evaluate speaker methods against labels.** Annotate turns, overlap, off-screen speech and face identities on held-out examples. Compare audio diarization plus audiovisual active-speaker association against the current approach. Measure identity error, switch delay and wrong-person screen time; a model's self-reported confidence is insufficient.
4. **Generate and rank multimodal moments.** Combine transcript discourse units with shot/action events and non-speech demonstrations. Score the actual first seconds, standalone comprehensibility, preserved meaning, payoff and visual suitability. Apply diversity only after those pass. Choose algorithms by blinded comparisons, not reputation or one successful example.
5. **Review rendered candidates before delivery.** Check opening/ending words, subtitle placement, crop containment and audio transitions on the final output. Reject or repair failures. Keep quality gates separate from engagement estimates, then validate engagement using viewer preference and retention data.

The boundary code provides a concrete likely mechanism: `highlights.ts` applies 0.25 s pre-roll and 0.6 s post-roll, while `normalizeClipEnd` determines the last word from the already-padded interval and can extend again into the next sentence. `render.ts` applies a fixed 0.4 s audio fade. A fix must coordinate semantic boundaries, neighboring words and available silent tail; reducing a constant alone is insufficient. These proposed repairs were **not implemented during this baseline run**.

## Method and limits

Production `analyzeProject`, visual rescoring, `ensureClipReframe` and `renderClip` processed full sources. Settings: short clips, auto layout, captions/tightening/automatic zoom enabled, B-roll and hook-first disabled; CPU H.264 at standard quality, 1080 × 1920. The run used the current working tree, including earlier changes, not an untouched Git commit. [Code provenance](../../.tmp/quality-corpus/full-baseline/code-provenance.json) records the compiled runner hash.

Each export was reviewed using six synchronized source/export frame pairs, timed transcript and surrounding context, plus full-file decoding and measured audio levels. Six panel/Wozniak exports were also retranscribed from their rendered audio. This same-model ASR check is not independent ground truth. Some suspected end fragments disappear from its transcript, so timestamp overlap is recorded as a risk rather than proof of an audible chopped word. The publisher clip's stray final caption is separately confirmed in a ten-frame tail strip.

No subjective listening, continuous-motion viewing, human speaker labels, audience retention measurements or matched OpusClip exports were completed. Speech/visual quality therefore remains partly unverified. This small, predominantly English corpus is a development baseline; independently labelled, held-out footage is still required before claiming an algorithm is better.

## ChatGPT connection and rerunning locally

The bridge uses the already authenticated `codex exec`, including structured output schemas and frame attachments. It consumes the account's Codex allowance. Codex manages authentication; account tokens were not copied into the project. [Official authentication documentation](https://learn.chatgpt.com/docs/auth) and [scripted execution](https://learn.chatgpt.com/docs/non-interactive-mode).

The actual LLM is the Codex CLI default with user configuration excluded. The API model field recorded by the original pipeline is ignored by the bridge and must not be presented as the model tested. ASR uses faster-whisper 1.2.1 / large-v3, CUDA float16, beam 5, VAD and word timestamps; model revision `edaa852ec7e145841d8ffdb056a99866b5f0a478`.

On this prepared machine, `node .tmp/run-with-chatgpt.mjs` launches the isolated corpus runner and reuses completed cases/caches. The bridge binds to loopback with a random per-run local bearer token, injects its endpoint only into the child process, and shuts down with that process. It does not change normal app settings. Helpers, the Python environment, model cache, source media and rendered evidence are local ignored artifacts; this is not yet a portable installation command or a packaged app feature. Prompt text and selected frame images were sent through the signed-in Codex service; transcription ran locally.
