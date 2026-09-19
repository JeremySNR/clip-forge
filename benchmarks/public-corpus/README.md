# Public video evaluation corpus

Downloaded on 12 September 2026: **9 videos, approximately 2 hours 50 minutes**. Import files from [the ready folder](../../.tmp/quality-corpus/ready). Media and frame previews remain local in the gitignored `.tmp/quality-corpus/` directory; this catalog and its metadata are small enough to keep in Git.

Start with **godot-panel** for a mostly fixed five-person conversation, **nasa-static-interview** for a stationary single-speaker shot, and **wozniak-interview** for a two-person interview. The Wozniak recording includes camera cuts; it is not an uninterrupted wide shot.

See the [implemented quality improvements and remaining failures](improvement-review-2026-09-12.md), with [playable before/after comparisons](../../.tmp/quality-corpus/improvement-review/index.html).

## Downloaded videos

| Source | Length | Content observed in sampled frames | Local files |
| --- | --- | --- | --- |
| [Shipping Godot: From Build to Player](https://media.ccc.de/v/godotfest2025-shipping-godot-from-build-to-player) | 51:49 | Fixed wide view of five seated panelists, with audience silhouettes in the foreground. | [Video](../../.tmp/quality-corpus/ready/godot-panel.mp4) · [Frames](../../.tmp/quality-corpus/previews/godot-panel-contact.jpg) |
| [James Webb Space Telescope — Eric Smith fixed-camera interview with slates](https://svs.gsfc.nasa.gov/12548/) | 3:19 | Single speaker filmed with a stationary camera; black question/title slates interrupt the interview. | [Video](../../.tmp/quality-corpus/ready/nasa-eric-smith-static-interview.webm) · [Frames](../../.tmp/quality-corpus/previews/nasa-static-interview-contact.jpg) |
| [Interview with Steve Wozniak](https://commons.wikimedia.org/wiki/File:Interview_with_Steve_Wozniak.webm) | 14:48 | Two-person sofa interview alternating a fixed two-shot and close-ups. | [Video](../../.tmp/quality-corpus/ready/wozniak-interview.webm) · [Frames](../../.tmp/quality-corpus/previews/wozniak-interview-contact.jpg) |
| [Extreme weather with Hannah Cloke](https://commons.wikimedia.org/wiki/File:Interview_on_extreme_weather_with_physical_geographer_Hannah_Cloke_%E2%80%93_The_Royal_Society.webm) | 10:26 | Studio science interview alternating two-shots and close-ups. | [Video](../../.tmp/quality-corpus/ready/hannah-cloke-interview.webm) · [Frames](../../.tmp/quality-corpus/previews/hannah-cloke-interview-contact.jpg) |
| [What Great Apes can tell us about language](https://commons.wikimedia.org/wiki/File:Interview_with_human_and_animal_psychologist_Gilly_Forrester_-_What_Great_Apes_can_tell_us_about_language_%E2%80%93_The_Royal_Society.webm) | 8:49 | Studio interview including a handheld puzzle-board demonstration. | [Video](../../.tmp/quality-corpus/ready/gilly-forrester-interview.webm) · [Frames](../../.tmp/quality-corpus/previews/gilly-forrester-interview-contact.jpg) |
| [Automation and Empathy: Can We Finally Replace All Artistic Performers with Machines?](https://media.ccc.de/v/38c3-automation-and-empathy-can-we-finally-replace-all-artistic-performers-with-machines) | 41:05 | Stage presentation with slides, a small presenter inset and visual demonstrations. | [Video](../../.tmp/quality-corpus/ready/automation-empathy-talk.webm) · [Frames](../../.tmp/quality-corpus/previews/automation-empathy-talk-contact.jpg) |
| [Content Translation Screencast (English)](https://commons.wikimedia.org/wiki/File:Content_Translation_Screencast_(English).webm) | 4:16 | Narrated Wikipedia translation screen recording with no visible speaker. | [Video](../../.tmp/quality-corpus/ready/narrated-screen-demo.webm) · [Frames](../../.tmp/quality-corpus/previews/narrated-screen-demo-contact.jpg) |
| [Blender Tutorial. A cup of tea.](https://commons.wikimedia.org/wiki/File:Blender_Tutorial._A_cup_of_tea..webm) | 22:50 | Blender modelling screen recording with no audio track. | [Video](../../.tmp/quality-corpus/ready/blender-screen-tutorial.webm) · [Frames](../../.tmp/quality-corpus/previews/blender-screen-tutorial-contact.jpg) |
| [Tears of Steel](https://mango.blender.org/download/) | 12:14 | Cinematic dialogue, action, effects, music, rapid cuts and a credits tail. | [Video](../../.tmp/quality-corpus/ready/tears-of-steel.mp4) · [Frames](../../.tmp/quality-corpus/previews/tears-of-steel-contact.jpg) |

## What to test

- **godot-panel:** Active speaker selection among visible listeners; stable framing; long-form highlight selection.
- **nasa-static-interview:** Speaker reacquisition after slates; silence handling; consistent single-person framing.
- **wozniak-interview:** Speaker changes, off-screen interviewer, listener gestures and conversational clip boundaries.
- **hannah-cloke-interview:** Complete explanations, clean hooks, speaker continuity across camera cuts.
- **gilly-forrester-interview:** Keep meaningful props visible; preserve explanation and payoff; distinguish listener from speaker.
- **automation-empathy-talk:** Layout selection, small faces, slides and demonstrations that must remain intelligible.
- **narrated-screen-demo:** Preserve UI text; avoid invented face tracks; align narration with demonstrated actions.
- **blender-screen-tutorial:** Intentional negative control: no hallucinated speech or speakers; visual-only content handling.
- **tears-of-steel:** Shot boundaries, non-speech audio, dialogue context, credits exclusion and cinematic reframing.

## Preparation and verification

- All nine files were probed, hashed with SHA-256, and decoded in five-second windows near the beginning, middle and end. Eight sampled frames per video were inspected. This is sampled verification, not a full-file decode or a complete editorial viewing.
- The Godot panel and CCC talk were remuxed to keep the main picture and first/English audio. Extra picture/audio streams were removed without re-encoding retained streams.
- Tears of Steel keeps the original H.264 picture in an MP4 container; its MP3 audio was converted to AAC at 192 kbps. Other ready files are unchanged originals sharing disk data through hard links. Preserve originals by writing any edits to new files.
- The Blender tutorial has **no audio track** and is deliberately retained as a negative control. NASA's question slates include silence.
- [inventory.json](inventory.json) records ready-file paths, dimensions, durations, codecs, original and ready SHA-256 hashes, preparation changes, and verification windows. [sources.json](sources.json) records download URLs, creators and license links. Full download receipts are in [receipts](../../.tmp/quality-corpus/receipts).

## Evaluation status

The first complete-source pipeline run is now documented in [full-review-2026-09-12.md](full-review-2026-09-12.md): eight sources produced 24 ranked exports through an experimental ChatGPT/Codex + local Whisper bridge; the silent source failed during audio extraction. [Play the clips and read the individual findings](../../.tmp/quality-corpus/full-baseline/review.html). The earlier fixed-window framing diagnostic is in [local-review-2026-09-12.md](local-review-2026-09-12.md).

This is a pilot corpus, not a measured quality result. No OpusClip comparisons or human gold labels have been created for these videos. Development/test assignments are provisional; both Royal Society interviews are grouped together in the test split to keep the shared host/setup from crossing splits. Preserve that grouping when making excerpts. Before model selection, label held-out speaker turns, framing failures and worthwhile clip moments, then use the [quality benchmark workflow](../../docs/quality-benchmark.md) for blind comparisons.

The current set is predominantly English. Remote calls, sports/gameplay, multilingual speech and deliberately difficult overlapping speech remain coverage gaps.

AMI meeting footage was considered, but its official video server returned HTTP 403. No AMI video or companion audio was downloaded. The downloaded AMI annotation archive is ancillary only and does not label these nine videos. Unavailable candidates are explicitly separated in the source manifest.

## Attribution

- **Shipping Godot: From Build to Player:** Ben Vehling, Paul Lawitzki, Pablo Navarro, Dom Harris, Joseph Hill; GodotFest / CCC VOC recording. [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- **James Webb Space Telescope — Eric Smith fixed-camera interview with slates:** NASA's Goddard Space Flight Center; Eric Smith. [NASA public-use media; retain NASA/GSFC credit and check item-specific credits before redistribution](https://svs.gsfc.nasa.gov/help/).
- **Interview with Steve Wozniak:** ConversationEDU / The Conversation. [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
- **Extreme weather with Hannah Cloke:** The Royal Society; Roma Agrawal and Hannah Cloke. [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
- **What Great Apes can tell us about language:** The Royal Society; Roma Agrawal and Gilly Forrester. [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
- **Automation and Empathy: Can We Finally Replace All Artistic Performers with Machines?:** Moritz Simon Geist; CCC VOC recording. [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- **Content Translation Screencast (English):** Pau Giner. [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- **Blender Tutorial. A cup of tea.:** Fun with Open Source. [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
- **Tears of Steel:** Blender Foundation / Mango Open Movie Project. [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).

Retain source credits and the listed license terms with shared excerpts. The narrated screen demo uses CC BY-SA 4.0; its share-alike terms differ from the CC BY sources. NASA item-specific credits are linked from its source page. No footage was uploaded to an AI service during acquisition.
