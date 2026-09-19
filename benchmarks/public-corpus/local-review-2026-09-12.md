# Local framing diagnostic — 12 September 2026

Nine real-source windows were processed with the production `analyzeClipFocus`, `applyFocusAnalysis` and `renderClip` functions. Every window starts at floor(40% of source duration) and lasts 20 seconds. These are fixed diagnostic windows, **not AI-selected highlights**. Captions, titles, tightening and automatic emphasis zoom were disabled. The automatic layout and speaker tracking were enabled; exports used CPU H.264 at standard quality, 1080 × 1920.

All nine renders completed and passed a full FFmpeg decode of the exported 20 seconds. Original recordings have only been sample-decoded. Five synchronized source/export frame pairs per diagnostic were visually inspected. The last empty contact-sheet cell is padding, not a black frame in the video. Audio was measured, not subjectively listened to. This diagnostic does not establish speaker identity accuracy, caption accuracy or engagement.

## Findings

| Source and original interval | Visual observation | Assessment |
| --- | --- | --- |
| Godot panel, 1243–1263 s | The crop contains central panelists, substantial empty wall and foreground audience heads. | Composition needs improvement; speaker choice needs an independent audio/turn review. |
| NASA interview, 79–99 s | Speaker remains visible, but the question slate is cropped horizontally, removing the beginning and end of its text. | Clear failure for the slate. Layout must change when text replaces the speaker. |
| Wozniak interview, 355–375 s | Face remains in frame in the inspected close-up samples; gestures are partly cropped. | Reasonable simple close-up; not evidence of success on two-person speaker changes. |
| Hannah Cloke interview, 250–270 s | Sampled host and guest close-ups remain framed across a shot change. | Reasonable sampled framing. Speech identity and caption timing remain untested. |
| Gilly Forrester interview, 211–231 s | Close-ups are reasonable, but the cut to the studio-wide view produces a crop containing the host while excluding the guest and much of the set. | Needs an audio-aware review of that shot; preserving just one detected face loses conversational context. |
| Automation and Empathy, 985–1005 s | The presentation layout is classified as speaker footage. The crop preserves the small presenter and removes most of the dance demonstration; later full-screen action is also heavily cropped. | Clear content-preservation failure. A visible face is not sufficient reason to crop around it. |
| Narrated screen demo, 102–122 s | The whole screen is retained in a letterboxed vertical canvas. | Avoids destructive crop, but small UI text uses little of the available vertical space. Needs a task-aware layout. |
| Silent Blender tutorial, 547–567 s | Classified as screencast and exported without inventing an audio track. Separate production audio extraction fails with a raw FFmpeg no-stream error. | Local rendering works. The full speech pipeline needs a clear no-audio outcome. No ASR hallucination claim can be made because ASR did not run in this diagnostic. |
| Tears of Steel, 293–313 s | Several faces remain visible, but close-ups and action are aggressively cropped; parts of faces and narrative context are lost. | A horizontal face centre alone is insufficient for cinematic composition. |

The measured integrated loudness of the eight audible outputs ranged from −15.6 to −13.9 LUFS; measured true peaks ranged from −2.0 to −0.5 dBFS. These figures are technical observations, not proof of clear speech, correct synchronization or pleasing sound. No full-frame black intervals were detected in these exports.

## Evidence

Per-source folders contain `diagnostic.mp4`, `comparison.jpg`, `analysis.json` and `decode-audio-qc.log`:

- [All local diagnostic results](../../.tmp/quality-corpus/local-baseline/results.json)
- [Panel video](../../.tmp/quality-corpus/local-baseline/godot-panel/diagnostic.mp4)
- [NASA source/export comparison](../../.tmp/quality-corpus/local-baseline/nasa-static-interview/comparison.jpg)
- [Presentation source/export comparison](../../.tmp/quality-corpus/local-baseline/automation-empathy-talk/comparison.jpg)

The code currently assigns a single `speaker`/`screencast` content type to a whole clip based on face coverage and the existence of a focus track (`src/shared/contentType.ts`, `src/main/pipeline/faces.ts`). That explains the mixed-content failures observed here. The next framing experiment should represent layout and subject bounds over time, with explicit text/demo preservation and a wide/fit fallback on uncertain shots. Do not tune against this small sample and claim general quality improvement.

## ChatGPT-backed full run

The local Codex CLI is already authenticated using ChatGPT. A real structured image-analysis request through `codex exec` succeeded and independently reported the NASA question-text crop. No account tokens were copied into ClipForge.

An experimental local bridge is prepared in `.tmp/run-with-chatgpt.mjs`. It connects the existing OpenAI-compatible pipeline interface to:

- Codex CLI using the existing ChatGPT sign-in for structured text/image analysis. This uses the Codex allowance, not a Platform API key. Requests and responses are cached locally. The API model string is not the actual Codex model; provenance records that distinction.
- faster-whisper 1.2.1 with Whisper large-v3, CUDA float16, beam size 5, VAD, word timestamps, and `condition_on_previous_text=False`. Model revision: `edaa852ec7e145841d8ffdb056a99866b5f0a478` from `Systran/faster-whisper-large-v3`.

The bridge binds only to 127.0.0.1 on a dynamically assigned port with a random per-run bearer token. This local token is not an OpenAI credential. Experimental projects and renders live under `.tmp/quality-corpus/full-baseline/`; normal app settings are not changed. This is a test-run integration, not yet a Settings UI feature or a production connector.

The full runner processes original-length sources, applies production highlight selection, visual rescoring and reframing, and exports the top three clips per source. Failures stay in `run.json`. Transcript checkpoints and request caches support retrying. The completed run produced 24 exports from eight sources; see the [full review](full-review-2026-09-12.md) for results and limitations.

Documentation: [Codex authentication](https://learn.chatgpt.com/docs/auth), [structured non-interactive execution](https://learn.chatgpt.com/docs/non-interactive-mode), [faster-whisper](https://github.com/SYSTRAN/faster-whisper).
